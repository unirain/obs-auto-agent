import type { DeliveryRecord, GitHubFact } from "./types.js";
export function reconcileRecord(
  record: DeliveryRecord,
  fact: GitHubFact,
  now: string,
): DeliveryRecord {
  if (record.schema_version !== 1)
    throw new Error("Unsupported delivery record schema");
  const own = fact.prs.filter(
    (p) =>
      p.delivery_id === record.delivery_id ||
      (p.branch === record.branch &&
        !(record.superseded_by && p.delivery_id === record.superseded_by)),
  );
  if (
    own.length > 1 ||
    fact.prs.some((p) => p.branch !== record.branch && p.state === "open")
  )
    return {
      ...record,
      status: "delivery_conflict",
      reason: "Multiple project deliveries/PRs",
      uncertain_action: null,
      updated_at: now,
    };
  const pr = own[0];
  if (pr)
    return {
      ...record,
      pr,
      status: pr.state === "open" ? "awaiting_review" : pr.state,
      uncertain_action: null,
      reason: null,
      updated_at: now,
      ...(fact.merged_notes ? { merged_notes: fact.merged_notes } : {}),
      ...(fact.review_outcome ? { review_outcome: fact.review_outcome } : {}),
    };
  if (
    record.superseded_by &&
    fact.prs.some((p) => p.delivery_id === record.superseded_by)
  )
    return {
      ...record,
      status: "superseded",
      uncertain_action: null,
      reason: null,
      updated_at: now,
    };
  if (
    fact.default_branch_duplicate ||
    fact.pending_duplicate ||
    (fact.branch_sha !== null &&
      (!record.prepared ||
        fact.branch_sha !== record.prepared.commit_sha ||
        !fact.complete_diff_matches))
  )
    return {
      ...record,
      status: "delivery_conflict",
      reason: fact.pending_duplicate
        ? "Pending PR already contains source or target file"
        : "Default branch duplicate or modified delivery branch",
      uncertain_action: null,
      updated_at: now,
    };
  return {
    ...record,
    status: record.superseded_by ? "superseded" : "publishing",
    uncertain_action: null,
    reason: null,
    updated_at: now,
  };
}

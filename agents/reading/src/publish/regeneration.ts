import { canonicalJson, sha256 } from "../contracts/index.js";
import {
  branchFor,
  type SealedDelivery,
  type DeliveryRecord,
  type GitHubFact,
  type GitHubPort,
  type PullRequestFact,
} from "./types.js";
import { validatePreparedFiles, validateDelivery } from "./validate.js";
export interface GitHubReadAuthority {
  schema_version: 1;
  complete: boolean;
  repository: string;
  default_branch: string;
  default_commit_sha: string;
  checked_at: string;
}
export interface ProjectRemoteSnapshot extends GitHubReadAuthority {
  project_id: string;
  branch_heads: { ref: string; sha: string }[];
  prs: PullRequestFact[];
}
export interface GenerationReadinessPort extends Pick<GitHubPort, "inspect"> {
  authority(): Promise<GitHubReadAuthority>;
  projectSnapshot(projectId: string): Promise<ProjectRemoteSnapshot>;
}
export interface HistoricalDelivery {
  seal: SealedDelivery;
  record: DeliveryRecord | null;
}
export interface GenerationReadinessInput {
  github: GenerationReadinessPort;
  repository: string;
  workspace_id: string;
  project_id: string;
  expected_delivery_ids: string[];
  history: HistoricalDelivery[];
  now?: () => Date;
}
export interface GenerationReadinessAudit {
  schema_version: 1;
  kind: "generation_readiness";
  workspace_id: string;
  project_id: string;
  repository: string;
  checked_at: string;
  status: "allowed" | "blocked";
  complete: boolean;
  reason_codes: string[];
  authority: GitHubReadAuthority | null;
  before: ProjectRemoteSnapshot | null;
  after: ProjectRemoteSnapshot | null;
  deliveries: {
    delivery_id: string;
    generation_version: number;
    branch: string;
    prepared_commit_sha: string | null;
    record_status: string | null;
    uncertain_action: string | null;
    facts: Omit<GitHubFact, "merged_notes"> & {
      merged_note_hashes?: {
        path: string;
        sha: string;
        content_sha256: string;
      }[];
    };
  }[];
  audit_hash: string;
}
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function validateAuthority(a: GitHubReadAuthority, repository: string): void {
  if (
    a.schema_version !== 1 ||
    a.complete !== true ||
    a.repository.toLowerCase() !== repository.toLowerCase() ||
    !a.default_branch ||
    !sha(a.default_commit_sha) ||
    !Number.isFinite(Date.parse(a.checked_at))
  )
    throw new Error("unverified_remote_authority");
}
function snapshotIdentity(s: ProjectRemoteSnapshot): string {
  return canonicalJson({
    repository: s.repository.toLowerCase(),
    default_branch: s.default_branch,
    default_commit_sha: s.default_commit_sha,
    project_id: s.project_id,
    branch_heads: s.branch_heads
      .slice()
      .sort((a, b) => a.ref.localeCompare(b.ref)),
    prs: s.prs.slice().sort((a, b) => a.number - b.number),
  });
}
/** Read-only proof required before an explicitly requested new generation. It never makes uncertain writes disappear. */
export async function checkGenerationReadiness(
  input: GenerationReadinessInput,
): Promise<GenerationReadinessAudit> {
  const audit: GenerationReadinessAudit = {
    schema_version: 1,
    kind: "generation_readiness",
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    repository: input.repository,
    checked_at: (input.now ?? (() => new Date()))().toISOString(),
    status: "blocked",
    complete: false,
    reason_codes: [],
    authority: null,
    before: null,
    after: null,
    deliveries: [],
    audit_hash: "",
  };
  const deny = (reason: string) => {
    if (!audit.reason_codes.includes(reason)) audit.reason_codes.push(reason);
  };
  const finish = () => {
    audit.status =
      audit.complete && !audit.reason_codes.length ? "allowed" : "blocked";
    const { audit_hash, ...body } = audit;
    audit.audit_hash = sha256(canonicalJson(body));
    return audit;
  };
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(input.repository) ||
    !/^[A-Za-z0-9_-]+$/.test(input.project_id)
  ) {
    deny("invalid_trusted_identity");
    return finish();
  }
  const ids = input.history.map((h) => h.seal.delivery_id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(input.expected_delivery_ids).size !==
      input.expected_delivery_ids.length ||
    canonicalJson(ids.slice().sort()) !==
      canonicalJson(input.expected_delivery_ids.slice().sort())
  ) {
    deny("historical_delivery_set_incomplete");
    return finish();
  }
  for (const h of input.history) {
    const d = h.seal,
      r = h.record;
    try {
      validateDelivery(d, {
        id: input.workspace_id,
        revision: d.workspace_revision,
      });
    } catch {
      deny("historical_seal_invalid");
      return finish();
    }
    if (
      d.schema_version !== 1 ||
      d.execution_scope !== "production" ||
      d.workspace_id !== input.workspace_id ||
      d.project_id !== input.project_id ||
      !Number.isSafeInteger(d.generation_version) ||
      d.generation_version < 1
    ) {
      deny("historical_seal_identity_or_schema_invalid");
      return finish();
    }
    if (
      r &&
      (r.schema_version !== 1 ||
        r.delivery_id !== d.delivery_id ||
        r.project_id !== d.project_id ||
        r.generation_version !== d.generation_version ||
        r.branch !== branchFor(d) ||
        ![
          "publishing",
          "awaiting_review",
          "closed_unmerged",
          "merged",
          "delivery_conflict",
          "needs_resume",
          "policy_blocked",
          "superseded",
        ].includes(r.status) ||
        (r.uncertain_action !== null && typeof r.uncertain_action !== "string"))
    ) {
      deny("historical_record_identity_or_schema_invalid");
      return finish();
    }
    if (r?.prepared) {
      try {
        if (
          !sha(r.prepared.commit_sha) ||
          !sha(r.prepared.tree_sha) ||
          !sha(r.prepared.base_tree)
        )
          throw new Error("commit_sha_invalid");
        validatePreparedFiles(d, r.prepared);
      } catch {
        deny("historical_commit_binding_conflict");
        return finish();
      }
    }
  }
  try {
    audit.authority = await input.github.authority();
    validateAuthority(audit.authority, input.repository);
    audit.before = await input.github.projectSnapshot(input.project_id);
    validateAuthority(audit.before, input.repository);
    if (audit.before.project_id !== input.project_id)
      throw new Error("project_scope_mismatch");
    if (audit.before.prs.length) deny("historical_pr_exists");
    for (const h of input.history) {
      const facts = await input.github.inspect(
        h.seal,
        h.record?.prepared ?? undefined,
      );
      if (
        typeof facts.expected_commit_exists !== "boolean" ||
        typeof facts.complete_diff_matches !== "boolean" ||
        typeof facts.default_branch_duplicate !== "boolean" ||
        (facts.pending_duplicate !== undefined &&
          typeof facts.pending_duplicate !== "boolean") ||
        (facts.branch_sha !== null && !sha(facts.branch_sha)) ||
        !Array.isArray(facts.prs)
      )
        throw new Error("invalid_actual_inspection_facts");
      if (!facts.observation)
        throw new Error("missing_actual_inspection_observation");
      validateAuthority(facts.observation, input.repository);
      if (
        facts.observation.project_id !== input.project_id ||
        facts.observation.default_branch !== audit.before.default_branch ||
        facts.observation.default_commit_sha !== audit.before.default_commit_sha
      )
        throw new Error("inconsistent_actual_inspection_observation");
      audit.deliveries.push({
        delivery_id: h.seal.delivery_id,
        generation_version: h.seal.generation_version,
        branch: branchFor(h.seal),
        prepared_commit_sha: h.record?.prepared?.commit_sha ?? null,
        record_status: h.record?.status ?? null,
        uncertain_action: h.record?.uncertain_action ?? null,
        facts: (() => {
          const { merged_notes, ...metadata } = facts;
          return {
            ...metadata,
            ...(merged_notes
              ? {
                  merged_note_hashes: merged_notes.map((n) => ({
                    path: n.path,
                    sha: n.sha,
                    content_sha256: sha256(n.content),
                  })),
                }
              : {}),
          };
        })(),
      });
      if (
        facts.prs.length ||
        h.record?.pr ||
        ["awaiting_review", "closed_unmerged", "merged"].includes(
          h.record?.status ?? "",
        )
      )
        deny("historical_pr_exists");
      if (h.record && h.record.uncertain_action !== null)
        deny("historical_remote_write_unresolved");
      if (
        h.record?.status === "delivery_conflict" ||
        facts.default_branch_duplicate ||
        facts.pending_duplicate
      )
        deny("historical_delivery_conflict");
      if (
        facts.branch_sha !== null &&
        (!h.record?.prepared ||
          facts.branch_sha !== h.record.prepared.commit_sha ||
          !facts.expected_commit_exists ||
          !facts.complete_diff_matches)
      )
        deny("historical_branch_not_exactly_verified");
      if (facts.expected_commit_exists && !facts.complete_diff_matches)
        deny("historical_commit_diff_unverified");
    }
    audit.after = await input.github.projectSnapshot(input.project_id);
    validateAuthority(audit.after, input.repository);
    if (audit.after.project_id !== input.project_id)
      throw new Error("project_scope_mismatch");
    if (audit.before.prs.length || audit.after.prs.length)
      deny("historical_pr_exists");
    if (snapshotIdentity(audit.before) !== snapshotIdentity(audit.after))
      deny("remote_project_references_changed");
    if (
      audit.authority.default_branch !== audit.before.default_branch ||
      audit.authority.default_commit_sha !== audit.before.default_commit_sha
    )
      deny("remote_default_reference_changed");
    const known = new Set(
      input.history.map((h) => `refs/heads/${branchFor(h.seal)}`),
    );
    for (const head of [
      ...audit.before.branch_heads,
      ...audit.after.branch_heads,
    ]) {
      if (!sha(head.sha) || !known.has(head.ref)) {
        deny("untracked_project_branch");
        continue;
      }
      const row = audit.deliveries.find(
        (d) => `refs/heads/${d.branch}` === head.ref,
      );
      if (!row || row.facts.branch_sha !== head.sha)
        deny("project_branch_facts_changed");
    }
    audit.complete = true;
  } catch {
    deny("remote_read_unavailable_or_incomplete");
  }
  return finish();
}

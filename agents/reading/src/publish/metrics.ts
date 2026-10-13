import type { DeliveryRecord, OperationsJournal } from "./types.js";
import { parseDeliveryRecord, parseHumanReviewFeedback } from "./contracts.js";
import { isUtcInstant } from "../contracts/utc.js";
export type ReviewOutcome =
  | "accepted_without_changes"
  | "accepted_with_changes"
  | "accepted_changes_unknown"
  | "rejected"
  | "pending";
export const FEEDBACK_REASONS = [
  "topic_irrelevant",
  "duplicate",
  "too_shallow",
  "incorrect_fact",
  "missing_source",
  "image_or_text_quality",
  "more_like_this",
] as const;
export interface HumanReviewFeedback {
  schema_version: 1;
  delivery_id: string;
  actor: string;
  recorded_at: string;
  reason: (typeof FEEDBACK_REASONS)[number] | null;
  review_minutes: number | null;
  origin: "trusted_management";
  pr_binding?: {
    repository: string;
    number: number;
    url: string;
    head_sha: string;
    state: "open" | "merged" | "closed_unmerged";
    checked_at: string;
  };
}
export interface DeliveryMetrics {
  confirmed_prs: number;
  merged_without_changes: number;
  merged_with_changes: number;
  merged_changes_unknown: number;
  rejected: number;
  pending: number;
  long_pending: number;
  pending_age_unknown: number;
  duplicate_prs: number;
  merge_ratio: number | null;
  rejection_ratio: number | null;
  human_review: {
    measured_count: number;
    total_minutes: number | null;
    unmeasured_count: number;
  };
  cost: {
    known_usd: number;
    unknown_project_count: number;
    cost_policy: "observe_only";
  };
  long_pending_days: number;
}
/** Metrics use actual PR identities, never generation counts or model-estimated human effort. */
export function deliveryMetrics(
  records: DeliveryRecord[],
  feedback: HumanReviewFeedback[],
  usage: Readonly<
    Record<
      string,
      { cost_status: "known" | "unknown"; cost_usd: number | null }
    >
  >,
  now: Date,
  longPendingDays: number,
): DeliveryMetrics {
  feedback.forEach(parseHumanReviewFeedback);
  if (!Number.isFinite(longPendingDays) || longPendingDays < 0)
    throw new Error("Invalid reporting pending-age threshold");
  const unique = new Map<string, DeliveryRecord>();
  for (const r of records) {
    if (r.schema_version !== 1)
      throw new Error("Unsupported delivery record schema");
    parseDeliveryRecord(r);
    if (r.pr) {
      const old = unique.get(r.pr.url);
      if (!old || Date.parse(r.updated_at) > Date.parse(old.updated_at))
        unique.set(r.pr.url, r);
    }
  }
  const result: DeliveryMetrics = {
    confirmed_prs: unique.size,
    merged_without_changes: 0,
    merged_with_changes: 0,
    merged_changes_unknown: 0,
    rejected: 0,
    pending: 0,
    long_pending: 0,
    pending_age_unknown: 0,
    duplicate_prs: 0,
    merge_ratio: null,
    rejection_ratio: null,
    human_review: {
      measured_count: 0,
      total_minutes: null,
      unmeasured_count: unique.size,
    },
    cost: {
      known_usd: 0,
      unknown_project_count: 0,
      cost_policy: "observe_only",
    },
    long_pending_days: longPendingDays,
  };
  const projects = new Map<string, Set<string>>();
  const amounts: number[] = [];
  for (const [url, r] of unique) {
    const p = r.pr!;
    projects.set(
      r.project_id,
      new Set([...(projects.get(r.project_id) ?? []), url]),
    );
    if (p.state === "merged") {
      if (r.review_outcome === "accepted_without_changes")
        result.merged_without_changes++;
      else if (r.review_outcome === "accepted_with_changes")
        result.merged_with_changes++;
      else result.merged_changes_unknown++;
    }
    if (p.state === "closed_unmerged") result.rejected++;
    if (p.state === "open") {
      result.pending++;
      const opened = p.created_at ? Date.parse(p.created_at) : NaN;
      if (!Number.isFinite(opened)) result.pending_age_unknown++;
      else if (now.getTime() - opened > longPendingDays * 86400000)
        result.long_pending++;
    }
    const human = feedback
      .filter(
        (f) =>
          f.delivery_id === r.delivery_id && f.origin === "trusted_management",
      )
      .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
      .at(-1);
    if (human?.review_minutes !== null && human?.review_minutes !== undefined) {
      if (!Number.isFinite(human.review_minutes) || human.review_minutes < 0)
        throw new Error("Invalid human review observation");
      amounts.push(human.review_minutes);
    }
  }
  result.duplicate_prs = [...projects.values()].reduce(
    (n, ids) => n + Math.max(0, ids.size - 1),
    0,
  );
  result.human_review.measured_count = amounts.length;
  result.human_review.unmeasured_count = unique.size - amounts.length;
  result.human_review.total_minutes = amounts.length
    ? amounts.reduce((n, m) => n + m, 0)
    : null;
  for (const id of projects.keys()) {
    const cost = usage[id];
    if (cost?.cost_status === "known" && cost.cost_usd !== null) {
      if (!Number.isFinite(cost.cost_usd) || cost.cost_usd < 0)
        throw new Error("Invalid project cost");
      result.cost.known_usd += cost.cost_usd;
    } else result.cost.unknown_project_count++;
  }
  const merged =
    result.merged_without_changes +
    result.merged_with_changes +
    result.merged_changes_unknown;
  const decided = merged + result.rejected;
  if (decided) {
    result.merge_ratio = merged / decided;
    result.rejection_ratio = result.rejected / decided;
  }
  return result;
}
/** @deprecated Standalone legacy write only. Root management requests must use prepareHumanReviewFeedback and atomically commit its bundle with their request audit. */
export async function recordHumanReviewFeedback(
  journal: OperationsJournal,
  feedback: HumanReviewFeedback,
): Promise<void> {
  parseHumanReviewFeedback(feedback);
  if (
    feedback.schema_version !== 1 ||
    feedback.origin !== "trusted_management" ||
    !/^[A-Za-z0-9-]+$/.test(feedback.actor) ||
    !isUtcInstant(feedback.recorded_at) ||
    (feedback.reason !== null && !FEEDBACK_REASONS.includes(feedback.reason)) ||
    (feedback.review_minutes !== null &&
      (!Number.isFinite(feedback.review_minutes) ||
        feedback.review_minutes < 0))
  )
    throw new Error("Invalid audited human feedback");
  const delivery = await journal.load<DeliveryRecord>(
    `delivery-${feedback.delivery_id}`,
  );
  if (delivery && delivery.schema_version !== 1)
    throw new Error("Unsupported delivery record schema");
  if (!delivery?.pr)
    throw new Error("Human feedback requires a confirmed actual PR");
  await journal.commit(`review-feedback/${feedback.delivery_id}`, feedback);
}

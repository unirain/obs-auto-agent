import type { DeliveryRecord, SealedDelivery } from "./types.js";
import { runtimeHours } from "../config/runtime-limits.js";
import { assertUtcInstant } from "../contracts/utc.js";
export type RecoveryRoute =
  | "read_only"
  | "publish"
  | "resume_source_verification"
  | "resume_classification"
  | "human_conflict";
export function recoveryRoute(
  d: SealedDelivery,
  records: DeliveryRecord[],
  currentClassification: boolean,
  now: Date,
  mode: "scheduled" | "resume" | "publish-only",
  sourcesFreshnessHours = 24,
): { route: RecoveryRoute; reason: string | null; model_allowed: boolean } {
  const freshnessMs =
    runtimeHours(sourcesFreshnessHours, "sources_freshness_hours") * 3_600_000;
  if (records.some((r) => r.uncertain_action))
    return {
      route: "read_only",
      reason: "remote_result_unknown",
      model_allowed: false,
    };
  if (
    records.some((r) =>
      ["awaiting_review", "closed_unmerged", "merged"].includes(r.status),
    )
  )
    return { route: "read_only", reason: "existing_pr", model_allowed: false };
  if (records.some((r) => r.status === "delivery_conflict"))
    return {
      route: "human_conflict",
      reason: "delivery_conflict",
      model_allowed: false,
    };
  if (!currentClassification)
    return {
      route: "resume_classification",
      reason: "classification_invalid",
      model_allowed: mode !== "publish-only",
    };
  const verifiedAt = Date.parse(d.sources_verified_at);
  assertUtcInstant(d.sources_verified_at, "sources_verified_at");
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(now.getTime()))
    throw new Error("Invalid source verification time");
  if (now.getTime() - verifiedAt > freshnessMs)
    return {
      route: "resume_source_verification",
      reason: "sources_expired",
      model_allowed: mode !== "publish-only",
    };
  return { route: "publish", reason: null, model_allowed: false };
}
/** Refresh is legal only after all old remote writes were conclusively reconciled. */
export function assertRefreshAllowed(records: DeliveryRecord[]): void {
  if (
    records.some(
      (r) =>
        r.uncertain_action ||
        r.pr ||
        [
          "awaiting_review",
          "closed_unmerged",
          "merged",
          "delivery_conflict",
        ].includes(r.status),
    )
  )
    throw new Error("Cannot refresh before full historical reconciliation");
}

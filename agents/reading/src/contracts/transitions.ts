import {
  AgentError,
  type CheckpointChange,
  type WorkspaceHandle,
} from "./index.js";
export type TransitionValidator = (
  handle: WorkspaceHandle,
  change: CheckpointChange,
) => void;
const validators = new Map<string, TransitionValidator>();
const builtinEvents = new Set([
  "collection_committed",
  "manual_submission_committed",
  "policy_checked",
  "invocation_prepared",
  "invocation_observed",
  "invocation_finished",
  "stage_completed",
  "batch_yielded",
  "storage_reserved",
  "storage_reconciled",
  "delivery_sealed",
  "delivery_recorded",
  "run_recorded",
]);
export function registerTransition(
  type: string,
  validator: TransitionValidator,
): void {
  if (validators.has(type))
    throw new AgentError("configuration", "Transition registered twice");
  validators.set(type, validator);
}
const lifecycle: Record<string, string[]> = {
  queued: ["selecting", "paused"],
  selecting: ["researching", "skipped", "deferred", "paused"],
  researching: ["writing", "deferred", "paused"],
  writing: ["reviewing", "deferred", "paused"],
  reviewing: [
    "writing",
    "ready_for_delivery",
    "preview_complete",
    "deferred",
    "paused",
  ],
  ready_for_delivery: ["publishing", "paused"],
  publishing: [
    "awaiting_review",
    "delivery_conflict",
    "needs_resume",
    "policy_blocked",
  ],
  awaiting_review: ["merged", "closed_unmerged"],
  paused: [
    "selecting",
    "researching",
    "writing",
    "reviewing",
    "ready_for_delivery",
  ],
};
export function validateChange(
  handle: WorkspaceHandle,
  change: CheckpointChange,
): void {
  if (!change.reason || !change.run_id)
    throw new AgentError("corrupt", "Checkpoint reason/run required");
  const event = change.event;
  if (!event) return;
  if (
    typeof event.type !== "string" ||
    !event.type ||
    Object.keys(event).some(
      (key) => !["type", "subject_id", "from", "to"].includes(key),
    ) ||
    Object.values(event).some((value) => typeof value !== "string" || !value)
  )
    throw new AgentError("corrupt", "Invalid checkpoint event envelope");
  const v = validators.get(event.type);
  if (v) {
    v(handle, change);
    return;
  }
  if (!builtinEvents.has(event.type))
    throw new AgentError("corrupt", "Unknown checkpoint event type");
  if (event.from !== undefined || event.to !== undefined) {
    if (!event.from || !event.to || !lifecycle[event.from]?.includes(event.to))
      throw new AgentError("corrupt", "Illegal project transition");
    if (
      handle.execution_scope === "preview" &&
      [
        "ready_for_delivery",
        "publishing",
        "awaiting_review",
        "merged",
      ].includes(event.to)
    )
      throw new AgentError("scope", "Preview cannot acquire delivery state");
  }
}

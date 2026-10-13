import type {
  CheckpointChange,
  WorkspaceManifest,
} from "../contracts/index.js";
/** Only host event names select the control reserve. Model DTOs never expose this function or write_kind. */
const control = new Set([
  "initialize",
  "policy_checked",
  "invocation_prepared",
  "invocation_observed",
  "invocation_finished",
  "invocation_reconciled",
  "storage_reserved",
  "storage_reconciled",
  "delivery_recorded",
  "delivery_reconciled",
  "run_recorded",
  "batch_claimed",
  "tool_or_revision_budget",
  "first_generation_date",
  "publishing_started",
  "publishing_requires_reconciliation",
  "delivery_result",
  "delivery_ready",
  "sources_verified",
  "github_reconciled",
  "review_result",
  "preview_output_sealed",
  "maintenance_references_detached",
  "delivery_refreshed_unchanged_sources",
  "current_knowledge_observed",
  "source_incidents_reconciled",
]);
const generation = new Set([
  "collection_committed",
  "source_page_and_candidates",
  "manual_submission_and_candidates",
  "manual_submission_committed",
  "project_created",
  "generation_context_fixed",
  "source_snapshot",
  "source_changed_new_generation",
  "draft_complete",
  "research_complete",
  "render_artifact",
  "source_image_downloaded",
]);
export function checkpointWriteKind(
  manifest: WorkspaceManifest,
  newBlobHashes: Set<string>,
  explicit?: CheckpointChange["write_kind"],
): "control" | "generation" {
  if (
    manifest.files.some(
      (f) =>
        newBlobHashes.has(f.sha256) && !["control", "report"].includes(f.role),
    )
  )
    return "generation";
  const reason = manifest.checkpoint_reason;
  if (
    generation.has(reason) ||
    /^record:(identity|candidates|contexts\/|projects\/)/.test(reason)
  )
    return "generation";
  if (explicit) return explicit;
  if (
    control.has(reason) ||
    /^record:(policy-checks\/|invocations\/|invocation_meta\/|invocation_order$|receipts\/|responses\/|observations\/|consumed\/|usage|runs\/|deliver(?:y|-)|sealed-|resource-|resources\/|storage\/|maintenance\/|knowledge-views\/)/.test(
      reason,
    ) ||
    /^(classify_only|select|research|write|review)_format_(invalid|exhausted)$/.test(
      reason,
    ) ||
    /^classification_(attempt_reserved|result|format_invalid|format_exhausted)$/.test(
      reason,
    )
  )
    return "control";
  return "generation";
}

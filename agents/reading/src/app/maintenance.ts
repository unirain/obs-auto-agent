import type {
  JsonValue,
  ObjectStore,
  InvocationRecord,
  WorkspaceHandle,
} from "../contracts/index.js";
import { ImmutableWorkspaceManager } from "../workspace/manager.js";
import { collectGarbage, type GcResult } from "../workspace/gc.js";
import { WorkspaceJournal } from "./journal.js";
export interface DeliveryRetentionFact {
  status: "open" | "merged" | "closed_unmerged" | "absent" | "unknown";
  finished_at?: string;
  complete: boolean;
}
export interface MaintenanceOptions {
  manager: ImmutableWorkspaceManager;
  journal: WorkspaceJournal;
  store: ObjectStore;
  prefix: string;
  now?: Date;
  with_mutex: <T>(work: () => Promise<T>) => Promise<T>;
  delivery_fact?: (id: string) => Promise<DeliveryRetentionFact>;
  image_gc?: () => Promise<{
    complete?: boolean;
    deleted: string[];
    retained: string[];
    unknown: string[];
  }>;
  after_detach?: () => Promise<void>;
}
export interface MaintenanceResult {
  detached_projects: string[];
  retention_marked: string[];
  blocked_projects: { project_id: string; reason: string }[];
  gc: GcResult;
  image_gc: {
    status: "not_exercised" | "verified" | "incomplete";
    reason: string | null;
    deleted: string[];
    retained?: string[];
    unknown?: string[];
  };
}
const terminal = new Set([
  "merged",
  "closed_unmerged",
  "skipped",
  "preview_ready",
]);
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const date = (value: unknown): number | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null;
/** Detach first, then reference GC. An interrupted detach cannot erase the last committed project. */
export async function maintainWorkspace(
  options: MaintenanceOptions,
): Promise<MaintenanceResult> {
  return options.with_mutex(async () => {
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - 30 * 86400000;
    const records: Record<string, unknown> = {};
    const removals = new Set<string>();
    const result: MaintenanceResult = {
      detached_projects: [],
      retention_marked: [],
      blocked_projects: [],
      gc: { deleted: [], retained: [], unknown: [] },
      image_gc: {
        status: "not_exercised",
        reason: "verified_default_branch_and_PR_image_references_required",
        deleted: [],
      },
    };
    const projects = options.journal.keys("projects/");
    const invocations = options.journal
      .keys("invocations/")
      .concat(options.journal.keys("receipts/"));
    const expiredContexts = new Set<string>();
    const protectedContexts = new Set<string>();
    const protectedRevisions = new Set<string>();
    for (const key of projects) {
      const project = await options.journal.load<Record<string, unknown>>(key);
      if (!project) continue;
      const id = key.slice(9);
      const state = String(project.state);
      const context = object(project.context);
      const ctx = context?.context_id ?? project.context_id;
      const clockKey = `storage/retention/${id}`;
      if (!terminal.has(state)) {
        if (typeof ctx === "string") protectedContexts.add(ctx);
        if (await options.journal.load(clockKey)) records[clockKey] = null;
        continue;
      }
      if (project.retention_pruned === true) continue;
      let uncertain = false;
      const ownInvocations: string[] = [];
      for (const invocationKey of invocations) {
        const call =
          await options.journal.load<InvocationRecord>(invocationKey);
        if (!call || ![id, `project:${id}`].includes(call.subject_id)) continue;
        ownInvocations.push(call.invocation_id);
        if (["prepared", "running", "unknown"].includes(call.status))
          uncertain = true;
      }
      if (uncertain) {
        if (typeof ctx === "string") protectedContexts.add(ctx);
        result.blocked_projects.push({
          project_id: id,
          reason: "unresolved_invocation",
        });
        continue;
      }
      let ended = date(project.completed_at ?? project.ended_at);
      const deliveryId =
        typeof project.delivery_id === "string" ? project.delivery_id : null;
      if (deliveryId) {
        const stored = await options.journal.load<Record<string, unknown>>(
          `sealed-${deliveryId}`,
        );
        if (typeof stored?.workspace_revision === "string")
          protectedRevisions.add(stored.workspace_revision);
        let fact: DeliveryRetentionFact | undefined;
        try {
          fact = await options.delivery_fact?.(deliveryId);
        } catch {
          /* No read proof: retain. */
        }
        if (
          !fact?.complete ||
          !["merged", "closed_unmerged"].includes(fact.status)
        ) {
          if (typeof ctx === "string") protectedContexts.add(ctx);
          result.blocked_projects.push({
            project_id: id,
            reason: "delivery_references_unverified_or_open",
          });
          continue;
        }
        ended = date(fact.finished_at) ?? ended;
        // A verified terminal remote state no longer protects its historical source snapshot forever.
        if (typeof stored?.workspace_revision === "string")
          protectedRevisions.delete(stored.workspace_revision);
      }
      if (ended === null) {
        const clock = await options.journal.load<{
          terminal_state: string;
          generation_version: number;
          observed_at: string;
        }>(clockKey);
        if (
          clock &&
          clock.terminal_state === state &&
          clock.generation_version === project.generation_version
        )
          ended = date(clock.observed_at);
        else {
          records[clockKey] = {
            terminal_state: state,
            generation_version: project.generation_version,
            observed_at: now.toISOString(),
          };
          result.retention_marked.push(id);
          if (typeof ctx === "string") protectedContexts.add(ctx);
          continue;
        }
      }
      if (ended === null || ended > cutoff) {
        if (typeof ctx === "string") protectedContexts.add(ctx);
        continue;
      }
      const metadata: Record<string, unknown> = {
        schema_version: 1,
        project_id: id,
        workspace_id: project.workspace_id,
        execution_scope: project.execution_scope,
        state,
        candidate: project.candidate,
        created_at: project.created_at,
        completed_at: new Date(ended).toISOString(),
        generation_version: project.generation_version,
        context_id: ctx,
        filename: project.filename ?? null,
        note_date: project.note_date ?? null,
        delivery_id: deliveryId,
        retention_pruned: true,
        retention_pruned_at: now.toISOString(),
        reason: project.reason ?? null,
        selection: project.selection ?? null,
        knowledge_increment:
          object(project.research)?.knowledge_increment ?? null,
        usage_audit_ids: ownInvocations,
        skill_commit: context?.skill_commit ?? null,
      };
      records[key] = metadata;
      records[clockKey] = null;
      result.detached_projects.push(id);
      if (typeof ctx === "string") expiredContexts.add(ctx);
      for (const file of options.journal.handle.snapshot.manifest.files)
        if (
          file.project_id === id &&
          (file.path.startsWith(`projects/${id}/`) ||
            file.path.startsWith(`outputs/${id}/`))
        )
          removals.add(file.path);
      for (const invocationId of ownInvocations) {
        if (await options.journal.load(`responses/${invocationId}`))
          records[`responses/${invocationId}`] = null;
        for (const observationKey of options.journal.keys(
          `observations/${invocationId}/`,
        ))
          records[observationKey] = null;
      }
      if (await options.journal.load(`previews/${id}`))
        records[`previews/${id}`] = {
          schema_version: 1,
          project_id: id,
          execution_scope: project.execution_scope,
          status: "retention_expired",
          expired_at: now.toISOString(),
          publish_checks: "not_exercised",
        };
    }
    for (const contextId of expiredContexts)
      if (!protectedContexts.has(contextId)) {
        records[`contexts/${contextId}`] = null;
        for (const file of options.journal.handle.snapshot.manifest.files)
          if (file.path.startsWith(`inputs/${contextId}/`))
            removals.add(file.path);
      }
    // Unresolved and pending delivery snapshots remain protected even when no project selected them above.
    for (const key of options.journal.keys("delivery-")) {
      const delivery = await options.journal.load<Record<string, unknown>>(key);
      if (
        !delivery ||
        Array.isArray(delivery) ||
        typeof delivery.delivery_id !== "string"
      )
        continue;
      if (
        !["merged", "closed_unmerged", "superseded"].includes(
          String(delivery.status),
        )
      ) {
        const seal = await options.journal.load<Record<string, unknown>>(
          `sealed-${delivery.delivery_id}`,
        );
        if (typeof seal?.workspace_revision === "string")
          protectedRevisions.add(seal.workspace_revision);
      }
    }
    if (Object.keys(records).length || removals.size)
      await options.journal.commitMany(
        records,
        "maintenance_references_detached",
        [],
        [...removals],
      );
    await options.after_detach?.();
    result.gc = await collectGarbage(
      options.store,
      options.prefix,
      options.journal.handle,
      {
        protected_revisions: protectedRevisions,
        reference_knowledge_complete: true,
        now: now.toISOString(),
      },
    );
    if (options.image_gc) {
      const images = await options.image_gc();
      result.image_gc = {
        status:
          images.complete !== true || images.unknown.length
            ? "incomplete"
            : "verified",
        reason:
          images.complete !== true
            ? "image_reference_or_permission_unverified"
            : images.unknown.length
              ? "delete_reconciliation_required"
              : null,
        deleted: images.deleted,
        retained: images.retained,
        unknown: images.unknown,
      };
    }
    await options.journal.commit(
      `maintenance/${options.journal.run_id}`,
      result,
    );
    return result;
  });
}

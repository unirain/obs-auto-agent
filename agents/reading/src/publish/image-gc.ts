import { AgentError, canonicalJson, sha256 } from "../contracts/index.js";
import type { OperationsJournal, ResourceReceipt } from "./types.js";
import type { ImageObject } from "./resources.js";
export interface ImageVersion {
  key: string;
  version_id: string | null;
  bytes: number;
  created_at: string;
}
export interface ImageGCStore {
  inventory(): Promise<{ complete: boolean; objects: ImageVersion[] }>;
  getVersion(key: string, version: string | null): Promise<ImageObject | null>;
  deleteVersion(key: string, version: string | null): Promise<void>;
}
export interface RemoteImageReferences {
  complete: boolean;
  urls: Set<string>;
  default_branch_commit: string | null;
  open_pr_heads: { number: number; sha: string }[];
}
export interface ImageGCResult {
  complete: boolean;
  deleted: string[];
  retained: string[];
  unknown: string[];
  reason: string | null;
}
interface DeletionIntent {
  schema_version: 1;
  key: string;
  version_id: string | null;
  project_id: string;
  sha256: string;
  state: "deleting" | "deleted";
  planned_at: string;
  confirmed_at: string | null;
  references: {
    default_branch_commit: string | null;
    open_pr_heads: { number: number; sha: string }[];
  };
}
const object = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
const time = (v: unknown): number | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v))
    ? Date.parse(v)
    : null;
const terminal = new Set(["merged", "closed_unmerged", "skipped"]);
const projectStates = new Set([
  "discovered",
  "selected",
  "researching",
  "researched",
  "drafted",
  "reviewing",
  "validated",
  "ready_for_delivery",
  "publishing",
  "pr_open",
  "merged",
  "closed_unmerged",
  "skipped",
  "deferred",
  "failed",
  "preview_ready",
  "policy_blocked",
]);
const deliveryStates = new Set([
  "publishing",
  "awaiting_review",
  "closed_unmerged",
  "merged",
  "delivery_conflict",
  "needs_resume",
  "policy_blocked",
  "superseded",
]);
const callStates = new Set([
  "prepared",
  "running",
  "succeeded",
  "failed",
  "unknown",
]);
function knownRecord(
  key: string,
  value: unknown,
  states: Set<string>,
  field: "state" | "status",
): Record<string, unknown> {
  const r = object(value);
  if (
    !r ||
    r.schema_version !== 1 ||
    typeof r[field] !== "string" ||
    !states.has(r[field] as string)
  )
    throw new AgentError(
      "corrupt",
      `Unsupported ${key.split("/")[0]} record schema/state during image GC`,
    );
  return r;
}

export interface ImageProtection {
  receipts: Map<string, ResourceReceipt>;
  protected_keys: Set<string>;
  unknown_projects: Set<string>;
  eligible_projects: Set<string>;
}
/** Untracked objects never become automatically deletable. A receipt proves ownership, not lack of references. */
export function imageProtection(
  records: Readonly<Record<string, unknown>>,
  prefix: string,
  now: Date,
): ImageProtection {
  const result: ImageProtection = {
    receipts: new Map(),
    protected_keys: new Set(),
    unknown_projects: new Set(),
    eligible_projects: new Set(),
  };
  const protect = (key: unknown) => {
    if (typeof key === "string" && key.startsWith(prefix))
      result.protected_keys.add(key);
  };
  const receipts = (values: unknown) => {
    if (!Array.isArray(values))
      throw new AgentError(
        "corrupt",
        "Invalid resource receipt collection during image GC",
      );
    for (const v of values) {
      const r = object(v);
      if (!r || typeof r.object_key !== "string")
        throw new AgentError(
          "corrupt",
          "Invalid resource receipt during image GC",
        );
      if (!r.object_key.startsWith(prefix)) continue;
      if (
        typeof r.project_id !== "string" ||
        typeof r.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(r.sha256) ||
        !Number.isSafeInteger(r.bytes) ||
        (r.bytes as number) <= 0 ||
        !r.object_key.includes(r.sha256) ||
        typeof r.url !== "string" ||
        !r.url.startsWith("https://") ||
        !["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(
          String(r.mime),
        ) ||
        time(r.confirmed_at) === null ||
        (r.version_id !== null && typeof r.version_id !== "string") ||
        (r.schema_version !== undefined && r.schema_version !== 1)
      )
        throw new AgentError(
          "corrupt",
          "Invalid resource receipt in GC protection",
        );
      result.receipts.set(r.object_key, r as unknown as ResourceReceipt);
    }
  };
  for (const [key, value] of Object.entries(records)) {
    const r = object(value);
    if (key.startsWith("image-gc-"))
      knownRecord(key, value, new Set(["deleting", "deleted"]), "state");
    if (key.startsWith("resources/")) receipts(value);
    if (key.startsWith("resource-")) {
      const r = knownRecord(
        key,
        value,
        new Set(["reserved", "unknown", "confirmed"]),
        "status",
      );
      if (typeof r.object_key !== "string")
        throw new AgentError(
          "corrupt",
          "Resource intent object key missing during GC",
        );
      if (r.status === "confirmed" && r.receipt) receipts([r.receipt]);
      else protect(r.object_key);
    }
    if (key.startsWith("storage/reservations/")) {
      const r = knownRecord(
        key,
        value,
        new Set(["pending", "confirmed", "released"]),
        "state",
      );
      if (typeof r.key !== "string")
        throw new AgentError("corrupt", "Reservation key missing during GC");
      if (r.state === "pending") protect(r.key);
    }
    if (key.startsWith("invocations/") || key.startsWith("receipts/")) {
      const r = knownRecord(key, value, callStates, "status");
      if (typeof r.subject_id !== "string")
        throw new AgentError("corrupt", "Invocation subject missing during GC");
      if (["prepared", "running", "unknown"].includes(r.status as string))
        result.unknown_projects.add(r.subject_id.replace(/^project:/, ""));
    }
    if (key.startsWith("projects/")) {
      const r = knownRecord(key, value, projectStates, "state");
      const id = key.slice("projects/".length);
      const pruned = time(r.retention_pruned_at);
      if (
        terminal.has(String(r.state)) &&
        r.state !== "merged" &&
        r.retention_pruned === true &&
        pruned !== null &&
        now.getTime() - pruned >= 30 * 86400000
      )
        result.eligible_projects.add(id);
      else result.unknown_projects.add(id);
    }
  }
  for (const [key, value] of Object.entries(records)) {
    if (key.startsWith("delivery-project-")) {
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
        throw new AgentError(
          "corrupt",
          "Invalid delivery index during image GC",
        );
      continue;
    }
    if (!key.startsWith("delivery-")) continue;
    const r = knownRecord(key, value, deliveryStates, "status");
    if (typeof r.delivery_id !== "string")
      throw new AgentError(
        "corrupt",
        "Delivery identity missing during image GC",
      );
    const sealed = object(records[`sealed-${r.delivery_id}`]);
    if (!sealed || sealed.schema_version !== 1)
      throw new AgentError(
        "corrupt",
        "Missing delivery manifest during image GC",
      );
    if (
      r.status === "merged" ||
      r.uncertain_action ||
      !["closed_unmerged", "superseded"].includes(String(r.status))
    )
      for (const resource of Array.isArray(sealed.resources)
        ? sealed.resources
        : [])
        protect(object(resource)?.object_key);
  }
  for (const receipt of result.receipts.values())
    if (
      result.unknown_projects.has(receipt.project_id) ||
      !result.eligible_projects.has(receipt.project_id)
    )
      result.protected_keys.add(receipt.object_key);
  return result;
}
function referenced(
  receipt: ResourceReceipt,
  references: RemoteImageReferences,
): boolean {
  if (references.urls.has(receipt.url)) return true;
  for (const raw of references.urls) {
    try {
      const url = new URL(raw);
      if (decodeURIComponent(url.pathname).endsWith("/" + receipt.object_key))
        return true;
    } catch {
      /* Invalid external text is never a capability. */
    }
  }
  return false;
}
export interface ImageGCOptions {
  execution_scope: "production" | "preview";
  prefix: string;
  journal: OperationsJournal;
  records: () => Readonly<Record<string, unknown>>;
  store: ImageGCStore;
  references: () => Promise<RemoteImageReferences>;
  beforeDelete: (
    projectId: string,
    key: string,
    version: string | null,
  ) => Promise<void>;
  /** Called only after complete inventory and read-back establish that all versions of this key are absent. */
  afterKeyAbsent: (key: string) => Promise<void>;
  now?: () => Date;
}
export async function collectImageGarbage(
  options: ImageGCOptions,
): Promise<ImageGCResult> {
  if (options.execution_scope !== "production")
    throw new AgentError("scope", "Preview cannot clean remote images");
  if (!options.prefix.endsWith("/") || options.prefix.includes(".."))
    throw new AgentError("configuration", "Invalid image GC prefix");
  const now = options.now ?? (() => new Date());
  const protection = imageProtection(options.records(), options.prefix, now());
  let inventory: { complete: boolean; objects: ImageVersion[] },
    references: RemoteImageReferences;
  try {
    inventory = await options.store.inventory();
    references = await options.references();
  } catch {
    return {
      complete: false,
      deleted: [],
      retained: [...protection.receipts.keys()],
      unknown: [...protection.receipts.keys()],
      reason: "reference_or_inventory_unavailable",
    };
  }
  if (!inventory.complete || !references.complete)
    return {
      complete: false,
      deleted: [],
      retained: inventory.objects.map((o) => o.key),
      unknown: inventory.objects.map((o) => o.key),
      reason: "reference_or_inventory_incomplete",
    };
  const result: ImageGCResult = {
    complete: true,
    deleted: [],
    retained: [],
    unknown: [],
    reason: null,
  };
  const byKey = new Map<string, ImageVersion[]>();
  for (const entry of inventory.objects) {
    if (
      !entry.key.startsWith(options.prefix) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      time(entry.created_at) === null
    )
      throw new AgentError(
        "corrupt",
        "Image inventory scope/size/date invalid",
      );
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  }
  // Reconcile deletions whose response was lost and whose object is no longer in the inventory.
  for (const [recordKey, value] of Object.entries(options.records())) {
    const intent = object(value);
    if (recordKey.startsWith("image-gc-"))
      knownRecord(recordKey, value, new Set(["deleting", "deleted"]), "state");
    if (
      intent?.schema_version !== 1 ||
      intent.state !== "deleting" ||
      typeof intent.key !== "string" ||
      !intent.key.startsWith(options.prefix) ||
      byKey.has(intent.key)
    )
      continue;
    const version =
      typeof intent.version_id === "string" ? intent.version_id : null;
    try {
      if ((await options.store.getVersion(intent.key, version)) !== null) {
        result.unknown.push(intent.key);
        continue;
      }
      await options.journal.commit(
        `image-gc-${sha256(canonicalJson([intent.key, version]))}`,
        { ...intent, state: "deleted", confirmed_at: now().toISOString() },
      );
      await options.afterKeyAbsent(intent.key);
      result.deleted.push(intent.key);
    } catch {
      result.unknown.push(intent.key);
    }
  }
  for (const [key, versions] of byKey) {
    const receipt = protection.receipts.get(key);
    if (
      !receipt ||
      protection.protected_keys.has(key) ||
      referenced(receipt, references) ||
      versions.some(
        (v) => now().getTime() - Date.parse(v.created_at) < 7 * 86400000,
      )
    ) {
      result.retained.push(key);
      continue;
    }
    let safe = true;
    for (const version of versions) {
      try {
        const actual = await options.store.getVersion(key, version.version_id);
        if (
          !actual ||
          sha256(actual.content) !== receipt.sha256 ||
          actual.content.length !== version.bytes ||
          actual.mime !== receipt.mime
        ) {
          safe = false;
          break;
        }
      } catch {
        safe = false;
        break;
      }
    }
    if (!safe) {
      result.unknown.push(key);
      result.retained.push(key);
      continue;
    }
    for (const version of versions) {
      const id = `image-gc-${sha256(canonicalJson([key, version.version_id]))}`;
      const intent: DeletionIntent = {
        schema_version: 1,
        key,
        version_id: version.version_id,
        project_id: receipt.project_id,
        sha256: receipt.sha256,
        state: "deleting",
        planned_at: now().toISOString(),
        confirmed_at: null,
        references: {
          default_branch_commit: references.default_branch_commit,
          open_pr_heads: references.open_pr_heads,
        },
      };
      // Permission and reference checks are refreshed at the deletion boundary, after durable intent.
      await options.journal.commit(id, intent);
      await options.beforeDelete(receipt.project_id, key, version.version_id);
      let fresh: RemoteImageReferences;
      try {
        fresh = await options.references();
      } catch {
        result.unknown.push(key);
        safe = false;
        break;
      }
      if (!fresh.complete || referenced(receipt, fresh)) {
        result.retained.push(key);
        safe = false;
        break;
      }
      try {
        await options.store.deleteVersion(key, version.version_id);
      } catch (e) {
        if (
          !(e instanceof AgentError) ||
          !["unknown", "transient"].includes(e.code)
        )
          throw e;
      }
      try {
        if (
          (await options.store.getVersion(key, version.version_id)) !== null
        ) {
          result.unknown.push(key);
          safe = false;
          break;
        }
      } catch {
        result.unknown.push(key);
        safe = false;
        break;
      }
      await options.journal.commit(id, {
        ...intent,
        state: "deleted",
        confirmed_at: now().toISOString(),
      });
    }
    if (safe) {
      const after = await options.store.inventory();
      if (!after.complete || after.objects.some((o) => o.key === key)) {
        result.unknown.push(key);
        continue;
      }
      await options.afterKeyAbsent(key);
      result.deleted.push(key);
    }
  }
  result.unknown = [...new Set(result.unknown)];
  result.retained = [...new Set(result.retained)];
  result.deleted = [...new Set(result.deleted)];
  if (result.unknown.length) {
    result.complete = false;
    result.reason = "image_deletion_or_reference_unknown";
  }
  return result;
}

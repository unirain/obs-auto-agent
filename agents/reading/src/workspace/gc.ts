import {
  AgentError,
  type ObjectStore,
  type WorkspaceHandle,
  type WorkspaceManifest,
} from "../contracts/index.js";
import { listAll } from "../storage/preflight.js";
import { decode, validateManifest } from "./manifest.js";
export interface GcProtection {
  protected_revisions: Set<string>;
  reference_knowledge_complete: boolean;
  now: string;
  historical_days?: number;
  orphan_days?: number;
}
export interface GcResult {
  deleted: string[];
  retained: string[];
  unknown: string[];
}
/** Invoke only after a committed checkpoint has removed expired project references, under global writer mutex. */
export async function collectGarbage(
  store: ObjectStore,
  prefix: string,
  head: WorkspaceHandle,
  protection: GcProtection,
): Promise<GcResult> {
  if (!protection.reference_knowledge_complete)
    throw new AgentError("unknown", "GC reference knowledge incomplete");
  const now = Date.parse(protection.now);
  if (!Number.isFinite(now)) throw new AgentError("corrupt", "Invalid GC time");
  const objects = await listAll(store, prefix);
  const required = new Set([head.revision, ...protection.protected_revisions]);
  const retainedManifests = new Set<string>();
  const referenced = new Set<string>();
  const result: GcResult = { deleted: [], retained: [], unknown: [] };
  const oldManifests: string[] = [];
  for (const o of objects.filter((o) =>
    o.key.startsWith(prefix + "manifests/"),
  )) {
    const m = decode<WorkspaceManifest>(await store.read(o.key), "workspace");
    validateManifest(m);
    if (
      m.workspace_id !== head.workspace_id ||
      m.execution_scope !== head.execution_scope ||
      o.key !== prefix + `manifests/${m.revision}.json`
    )
      throw new AgentError("corrupt", "GC manifest scope mismatch");
    if (
      required.has(m.revision) ||
      now - Date.parse(m.created_at) <
        (protection.historical_days ?? 30) * 86400000
    ) {
      retainedManifests.add(o.key);
      for (const f of m.files) referenced.add(prefix + "blobs/" + f.sha256);
    } else oldManifests.push(o.key);
  }
  for (const r of required)
    if (!retainedManifests.has(prefix + `manifests/${r}.json`))
      throw new AgentError("corrupt", "Protected manifest unavailable");
  const candidates = new Set(oldManifests);
  for (const o of objects) {
    if (
      o.key.startsWith(prefix + "blobs/") &&
      !referenced.has(o.key) &&
      now - Date.parse(o.created_at) >= (protection.orphan_days ?? 7) * 86400000
    )
      candidates.add(o.key);
  }
  for (const o of objects) {
    if (!candidates.has(o.key)) {
      result.retained.push(o.key);
      continue;
    }
    if (
      !o.key.startsWith(prefix + "blobs/") &&
      !o.key.startsWith(prefix + "manifests/")
    )
      throw new AgentError("permission", "GC cannot delete commits");
    try {
      await store.delete(o.key);
    } catch (e) {
      if (!(e instanceof AgentError) || e.code !== "unknown") throw e;
    }
    try {
      await store.stat(o.key);
      result.unknown.push(o.key);
    } catch (e) {
      if (e instanceof AgentError && e.code === "not_found")
        result.deleted.push(o.key);
      else {
        result.unknown.push(o.key);
      }
    }
  }
  return result;
}

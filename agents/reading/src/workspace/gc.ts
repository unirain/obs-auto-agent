import {
  AgentError,
  type ObjectStore,
  type WorkspaceHandle,
  type WorkspaceManifest,
  type CommitRecord,
  sha256,
} from "../contracts/index.js";
import { listAll } from "../storage/preflight.js";
import { assertUtcInstant } from "../contracts/utc.js";
import {
  decode,
  validateManifest,
  manifestBlobs,
  validateCommit,
  assertBytes,
} from "./manifest.js";
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
  assertUtcInstant(protection.now, "GC observed_at");
  const now = Date.parse(protection.now);
  const objects = await listAll(store, prefix);
  const commits = objects
    .filter((o) => o.key.startsWith(prefix + "commits/"))
    .sort((a, b) => a.key.localeCompare(b.key));
  const committed = new Map<string, CommitRecord>();
  const parents = new Map<string, string | null>();
  let priorRevision: string | null = null;
  let priorKey: string | null = null,
    priorHash: string | null = null;
  for (let i = 0; i < commits.length; i++) {
    const sequence = BigInt(i).toString().padStart(20, "0"),
      key = prefix + `commits/${sequence}.json`;
    if (commits[i]!.key !== key)
      throw new AgentError("corrupt", "GC commit sequence gap");
    const bytes = await store.read(key),
      commit = decode<CommitRecord>(bytes, "checkpoint");
    validateCommit(commit);
    if (
      commit.sequence !== sequence ||
      commit.workspace_id !== head.workspace_id ||
      commit.execution_scope !== head.execution_scope ||
      commit.parent_commit_key !== priorKey ||
      commit.parent_commit_sha256 !== priorHash ||
      commit.manifest_key !== prefix + `manifests/${commit.revision}.json` ||
      committed.has(commit.revision)
    )
      throw new AgentError("corrupt", "GC immutable commit chain invalid");
    parents.set(commit.revision, priorRevision);
    committed.set(commit.revision, commit);
    priorKey = key;
    priorHash = sha256(bytes);
    priorRevision = commit.revision;
  }
  if (
    priorKey !== head.snapshot.commit_key ||
    priorHash !== head.snapshot.commit_sha256
  )
    throw new AgentError("conflict", "GC requires the current verified HEAD");
  const required = new Set([head.revision, ...protection.protected_revisions]);
  const retainedManifests = new Set<string>();
  const referenced = new Set<string>();
  const result: GcResult = { deleted: [], retained: [], unknown: [] };
  const oldManifests: string[] = [];
  for (const o of objects.filter((o) =>
    o.key.startsWith(prefix + "manifests/"),
  )) {
    const bytes = await store.read(o.key);
    const m = decode<WorkspaceManifest>(bytes, "workspace");
    validateManifest(m);
    if (
      m.workspace_id !== head.workspace_id ||
      m.execution_scope !== head.execution_scope ||
      o.key !== prefix + `manifests/${m.revision}.json`
    )
      throw new AgentError("corrupt", "GC manifest scope mismatch");
    const commit = committed.get(m.revision);
    if (commit) {
      assertBytes(bytes, commit.manifest_sha256);
      if (m.parent_revision !== parents.get(m.revision))
        throw new AgentError("corrupt", "GC manifest parent mismatch");
    }
    if (required.has(m.revision) && !commit)
      throw new AgentError(
        "corrupt",
        "GC cannot protect an uncommitted revision",
      );
    if (
      required.has(m.revision) ||
      (commit
        ? now - Date.parse(m.created_at) <
          (protection.historical_days ?? 30) * 86400000
        : now - Date.parse(o.created_at) <
          (protection.orphan_days ?? 7) * 86400000)
    ) {
      retainedManifests.add(o.key);
      for (const f of m.files)
        for (const blob of manifestBlobs(f))
          referenced.add(prefix + "blobs/" + blob.sha256);
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

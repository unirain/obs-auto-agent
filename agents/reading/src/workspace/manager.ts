import {createSecretGuard,type SecretContentGuard} from '../security/secrets.js';
import { randomUUID } from "node:crypto";
import {
  mkdir,
  writeFile,
  lstat,
  readFile,
  link,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
  AgentError,
  sha256,
  type ObjectStore,
  type ExecutionScope,
  type CommitRecord,
  type WorkspaceManifest,
  type WorkspaceHandle,
  type CommittedSnapshot,
  type CheckpointChange,
  type CheckpointResult,
  type JsonValue,
  type WorkspaceManager,
  type ScopedRecordValidator,
} from "../contracts/index.js";
import {
  validateRecords,
  validateRestoredRecords,
} from "../contracts/records.js";
import { checkpointWriteKind } from "./write-kind.js";
import {
  validateChange,
  validateGenerationAuditPreservation,
} from "../contracts/transitions.js";
import { listAll, preflight } from "../storage/preflight.js";
import {
  encode,
  decode,
  assertBytes,
  validateCommit,
  validateManifest,
  manifestBlobs,
  readManifestFile,
} from "./manifest.js";
import {
  validateWorkspaceIdentity,
  validatePath,
  safeLocalPath,
  MAX_FILE_BYTES,
} from "./paths.js";
export interface ManagerOptions {
  content_validator?: (bytes:Uint8Array)=>void;
  store: ObjectStore;
  scope: ExecutionScope;
  local_root: string;
  prefix?: string;
  trusted_workspace_id?: string;
  verify_preflight?: boolean;
  lazy_restore?: boolean;
  /** Instance-specific schema policy. Checkpoint supplies merged records and null tombstones; restore supplies all existing records. */
  record_validator?: ScopedRecordValidator;
  capacity_check?: (
    bytes: number,
    kind: "control" | "generation",
  ) => Promise<void>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export class ImmutableWorkspaceManager implements WorkspaceManager {
  private readonly handles = new WeakSet<object>();
  private readonly historical = new WeakSet<object>();
  private readonly writing = new Set<string>();
  private readonly contentGuard:SecretContentGuard;
  constructor(readonly options: ManagerOptions) {this.contentGuard=options.content_validator??createSecretGuard();}
  prefix(id: string): string {
    validateWorkspaceIdentity(
      id,
      this.options.scope,
      this.options.trusted_workspace_id ?? "obs-notes-hub/reading",
    );
    return `${this.options.prefix ?? "workspaces"}/${id}/`;
  }
  async restore(
    workspaceId: string,
    options: { allow_initialize?: boolean; run_id?: string } = {},
  ): Promise<WorkspaceHandle> {
    const prefix = this.prefix(workspaceId);
    if (this.options.verify_preflight !== false)
      await preflight(this.options.store);
    const objects = await listAll(this.options.store, prefix + "commits/");
    if (objects.length === 0) {
      try {
        await this.options.store.read(
          prefix + "commits/00000000000000000000.json",
        );
        throw new AgentError(
          "corrupt",
          "Empty listing contradicts zero commit",
        );
      } catch (e) {
        if (!(e instanceof AgentError) || e.code !== "not_found") throw e;
      }
      if (!options.allow_initialize)
        throw new AgentError("not_found", "Workspace not initialized");
      const manifest: WorkspaceManifest = {
        schema_version: 1,
        workspace_id: workspaceId,
        execution_scope: this.options.scope,
        revision: randomUUID(),
        parent_revision: null,
        run_id: options.run_id ?? "initialize",
        checkpoint_reason: "initialize",
        created_at: new Date().toISOString(),
        files: [],
      };
      this.options.record_validator?.(
        Object.create(null) as Record<string, JsonValue | null>,
        this.options.scope,
        workspaceId,
      );
      const result = await this.publish(manifest, null, []);
      if (result.status === "unknown")
        throw new AgentError("unknown", result.reason);
      return this.restore(workspaceId);
    }
    let previous: CommittedSnapshot | null = null;
    const revisions = new Set<string>();
    for (let i = 0; i < objects.length; i++) {
      const sequence = BigInt(i).toString().padStart(20, "0");
      const key = prefix + `commits/${sequence}.json`;
      if (objects[i]?.key !== key)
        throw new AgentError("corrupt", "Illegal commit key or sequence gap");
      const bytes = await this.options.store.read(key);
      const commit = decode<CommitRecord>(bytes, "checkpoint");
      validateCommit(commit);
      if (revisions.has(commit.revision))
        throw new AgentError(
          "corrupt",
          "Duplicate revision identity in commit chain",
        );
      revisions.add(commit.revision);
      if (
        commit.sequence !== sequence ||
        commit.workspace_id !== workspaceId ||
        commit.execution_scope !== this.options.scope ||
        commit.parent_commit_key !== (previous?.commit_key ?? null) ||
        commit.parent_commit_sha256 !== (previous?.commit_sha256 ?? null) ||
        commit.manifest_key !== prefix + `manifests/${commit.revision}.json`
      )
        throw new AgentError("corrupt", "Commit chain mismatch");
      previous = {
        workspace_id: workspaceId,
        execution_scope: this.options.scope,
        revision: commit.revision,
        sequence,
        commit_key: key,
        commit_sha256: sha256(bytes),
        manifest_key: commit.manifest_key,
        manifest_sha256: commit.manifest_sha256,
        manifest: null as unknown as WorkspaceManifest,
      };
    }
    if (!previous) throw new AgentError("corrupt", "Missing HEAD");
    const bytes = await this.options.store.read(previous.manifest_key);
    assertBytes(bytes, previous.manifest_sha256);
    const manifest = decode<WorkspaceManifest>(bytes, "workspace");
    validateManifest(manifest);
    if (
      manifest.workspace_id !== workspaceId ||
      manifest.execution_scope !== this.options.scope ||
      manifest.revision !== previous.revision
    )
      throw new AgentError("scope", "HEAD manifest identity mismatch");
    if (objects.length > 1) {
      const parentBytes = await this.options.store.read(
        prefix +
          `commits/${(BigInt(previous.sequence) - 1n).toString().padStart(20, "0")}.json`,
      );
      const parent = decode<CommitRecord>(parentBytes, "checkpoint");
      if (manifest.parent_revision !== parent.revision)
        throw new AgentError("corrupt", "Manifest parent revision mismatch");
    } else if (manifest.parent_revision !== null)
      throw new AgentError("corrupt", "Initial manifest parent mismatch");
    previous.manifest = manifest;
    return this.materialize(previous, true);
  }
  async restoreRevision(
    workspaceId: string,
    revision: string,
  ): Promise<WorkspaceHandle> {
    const head = await this.restore(workspaceId);
    if (head.revision === revision) return head;
    const prefix = this.prefix(workspaceId);
    const objects = await listAll(this.options.store, prefix + "commits/");
    let parentRevision: string | null = null;
    for (const o of objects) {
      const bytes = await this.options.store.read(o.key);
      const c = decode<CommitRecord>(bytes, "checkpoint");
      if (c.revision === revision) {
        const manifestBytes = await this.options.store.read(c.manifest_key);
        assertBytes(manifestBytes, c.manifest_sha256);
        const manifest = decode<WorkspaceManifest>(manifestBytes, "workspace");
        validateManifest(manifest);
        if (
          manifest.revision !== revision ||
          manifest.workspace_id !== workspaceId ||
          manifest.execution_scope !== this.options.scope ||
          manifest.parent_revision !== parentRevision
        )
          throw new AgentError("corrupt", "Historical manifest chain mismatch");
        const snapshot: CommittedSnapshot = {
          workspace_id: workspaceId,
          execution_scope: this.options.scope,
          revision,
          sequence: c.sequence,
          commit_key: o.key,
          commit_sha256: sha256(bytes),
          manifest_key: c.manifest_key,
          manifest_sha256: c.manifest_sha256,
          manifest,
        };
        const handle = await this.materialize(snapshot, true);
        this.historical.add(handle);
        return handle;
      }
      parentRevision = c.revision;
    }
    throw new AgentError("not_found", "Revision is not committed");
  }
  private async materialize(
    snapshot: CommittedSnapshot,
    refresh_cache = false,
  ): Promise<WorkspaceHandle> {
    const root = join(
      this.options.local_root,
      sha256(snapshot.workspace_id),
      snapshot.revision,
    );
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink())
      throw new AgentError("corrupt", "Workspace root is symlink");
    const records: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    const prefix = this.prefix(snapshot.workspace_id);
    const inventory = this.options.lazy_restore
      ? new Map(
          (await listAll(this.options.store, prefix + "blobs/")).map((o) => [
            o.key,
            o,
          ]),
        )
      : null;
    for (const file of snapshot.manifest.files) {
      if (inventory) {
        for (const chunk of manifestBlobs(file)) {
          const object = inventory.get(prefix + "blobs/" + chunk.sha256);
          if (!object || object.size !== chunk.size)
            throw new AgentError(
              "corrupt",
              "HEAD references missing or wrong-sized blob",
            );
        }
      }
      if (file.role !== "control" && this.options.lazy_restore) continue;
      const bytes = await this.materializeFile(
        snapshot.workspace_id,
        root,
        file,
        refresh_cache,
      );
      if (
        file.role === "control" &&
        file.path.startsWith("state/") &&
        file.path.endsWith(".json")
      ) {
        try {
          records[file.path.slice(6, -5)] = JSON.parse(
            Buffer.from(bytes).toString("utf8"),
          ) as JsonValue;
        } catch {
          throw new AgentError("corrupt", "Control state is not JSON");
        }
      }
    }
    validateRestoredRecords(records, snapshot.execution_scope);
    this.options.record_validator?.(
      records,
      snapshot.execution_scope,
      snapshot.workspace_id,
    );
    if (this.options.lazy_restore) {
      const inactive = new Set<string>();
      for (const [key, value] of Object.entries(records))
        if (
          key.startsWith("projects/") &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          if (
            [
              "merged",
              "closed_unmerged",
              "skipped",
              "preview_ready",
              "pr_open",
            ].includes(String(value.state))
          )
            inactive.add(key.slice(9));
        }
      for (const file of snapshot.manifest.files)
        if (
          file.role !== "control" &&
          file.project_id &&
          !inactive.has(file.project_id)
        )
          await this.materializeFile(
            snapshot.workspace_id,
            root,
            file,
            refresh_cache,
          );
    }
    const handle = freeze({
      workspace_id: snapshot.workspace_id,
      execution_scope: snapshot.execution_scope,
      revision: snapshot.revision,
      root_dir: root,
      snapshot,
      records,
    });
    this.handles.add(handle);
    return handle;
  }
  private async materializeFile(
    workspaceId: string,
    root: string,
    file: WorkspaceManifest["files"][number],
    refresh_cache = false,
  ): Promise<Uint8Array> {
    const destination = await safeLocalPath(root, file.path);
    const cacheRoot = join(
      this.options.local_root,
      ".blob-cache",
      sha256(workspaceId),
    );
    await mkdir(cacheRoot, { recursive: true });
    const cache = join(cacheRoot, file.sha256);
    let bytes: Uint8Array | undefined;
    if (refresh_cache) {
      bytes = await readManifestFile(
        this.options.store,
        this.prefix(workspaceId),
        file,
      );
    }
    try {
      const cached = await readFile(cache);
      assertBytes(cached, file.sha256, file.size);
      bytes ??= cached;
    } catch (error) {
      if (
        !(error instanceof AgentError) &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
      bytes ??= await readManifestFile(
        this.options.store,
        this.prefix(workspaceId),
        file,
      );
      this.contentGuard(bytes);
      await unlink(cache).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      const pending = cache + "." + randomUUID();
      await writeFile(pending, bytes, { flag: "wx" });
      try {
        await link(pending, cache);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        await unlink(pending);
      }
    }
    this.contentGuard(bytes!);
    try {
      const actual = await readFile(destination);
      assertBytes(actual, file.sha256, file.size);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await link(cache, destination).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        assertBytes(await readFile(destination), file.sha256, file.size);
      });
    }
    return bytes!;
  }
  async readFile(handle: WorkspaceHandle, path: string): Promise<Uint8Array> {
    if (!this.handles.has(handle))
      throw new AgentError("scope", "Untrusted workspace handle");
    validatePath(path);
    const file = handle.snapshot.manifest.files.find((f) => f.path === path);
    if (!file)
      throw new AgentError(
        "not_found",
        "File is not part of committed snapshot",
      );
    return this.materializeFile(handle.workspace_id, handle.root_dir, file);
  }
  async checkpoint(
    handle: WorkspaceHandle,
    change: CheckpointChange,
  ): Promise<CheckpointResult> {
    if (
      !this.handles.has(handle) ||
      handle.execution_scope !== this.options.scope
    )
      throw new AgentError("scope", "Untrusted workspace handle");
    if (this.historical.has(handle))
      return { status: "conflict", reason: "Historical snapshot is read-only" };
    if (change.expected_revision !== handle.revision)
      return { status: "conflict", reason: "Stale expected revision" };
    if (this.writing.has(handle.workspace_id))
      return { status: "conflict", reason: "Concurrent local checkpoint" };
    validateChange(handle, change);
    for(const file of change.files??[])this.contentGuard(file.bytes);
    if(change.records)this.contentGuard(encode(change.records));
    validateRecords(handle, change);
    const proposed: Record<string, JsonValue | null> = Object.assign(
      Object.create(null),
      handle.records,
    );
    // Raw control files obey the same validators as record updates.
    for (const path of change.remove_paths ?? [])
      if (path.startsWith("state/") && path.endsWith(".json")) {
        proposed[path.slice(6, -5)] = null;
        validateRecords(handle, {
          ...change,
          records: { [path.slice(6, -5)]: null },
        });
      }
    for (const file of change.files ?? []) {
      if (!file.path.startsWith("state/") || !file.path.endsWith(".json"))
        continue;
      if (file.role !== "control")
        throw new AgentError("corrupt", "State file must be a control record");
      const key = file.path.slice(6, -5);
      if (Object.hasOwn(change.records ?? {}, key))
        throw new AgentError(
          "corrupt",
          "Control record updated by both files and records",
        );
      let value: JsonValue;
      try {
        value = JSON.parse(
          Buffer.from(file.bytes).toString("utf8"),
        ) as JsonValue;
      } catch {
        throw new AgentError("corrupt", "Control file is not JSON");
      }
      validateRecords(handle, {
        ...change,
        records: { [file.path.slice(6, -5)]: value },
      });
      proposed[key] = value;
    }
    Object.assign(proposed, change.records ?? {});
    validateGenerationAuditPreservation(
      handle.records,
      proposed,
      change.reason,
    );
    this.options.record_validator?.(
      proposed,
      handle.execution_scope,
      handle.workspace_id,
      { previous_records: handle.records, reason: change.reason },
    );
    this.writing.add(handle.workspace_id);
    try {
      if (this.options.verify_preflight !== false)
        await preflight(this.options.store);
      const files = new Map(
        handle.snapshot.manifest.files.map((f) => [f.path, f]),
      );
      const upload: { hash: string; bytes: Uint8Array }[] = [];
      for (const path of change.remove_paths ?? []) {
        validatePath(path);
        files.delete(path);
      }
      const updates = [...(change.files ?? [])];
      for (const [key, value] of Object.entries(change.records ?? {})) {
        const path = `state/${key}.json`;
        validatePath(path);
        if (value === null) {
          files.delete(path);
          continue;
        }
        updates.push({ path, bytes: encode(value), role: "control" });
      }
      const seen = new Set<string>();
      for (const f of updates) {
        validatePath(f.path);
        await safeLocalPath(handle.root_dir, f.path);
        if (seen.has(f.path))
          throw new AgentError("corrupt", "Repeated checkpoint path");
        seen.add(f.path);
        const hash = sha256(f.bytes);
        const chunks: { sha256: string; size: number }[] = [];
        if (f.bytes.length > MAX_FILE_BYTES) {
          for (
            let offset = 0;
            offset < f.bytes.length;
            offset += MAX_FILE_BYTES
          ) {
            const bytes = Uint8Array.from(
              f.bytes.subarray(offset, offset + MAX_FILE_BYTES),
            );
            const sha = sha256(bytes);
            chunks.push({ sha256: sha, size: bytes.length });
            upload.push({ hash: sha, bytes });
          }
        } else upload.push({ hash, bytes: Uint8Array.from(f.bytes) });
        files.set(f.path, {
          path: f.path,
          sha256: hash,
          size: f.bytes.length,
          ...(chunks.length ? { chunks } : {}),
          role: f.role,
          project_id: f.project_id ?? null,
        });
      }
      const manifest: WorkspaceManifest = {
        schema_version: 1,
        workspace_id: handle.workspace_id,
        execution_scope: handle.execution_scope,
        revision: randomUUID(),
        parent_revision: handle.revision,
        run_id: change.run_id,
        checkpoint_reason: change.reason,
        created_at: new Date().toISOString(),
        files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
      };
      validateManifest(manifest);
      return this.publish(manifest, handle.snapshot, upload, change.write_kind);
    } finally {
      this.writing.delete(handle.workspace_id);
    }
  }
  private async createOrVerify(key: string, bytes: Uint8Array): Promise<void> {
    try {
      await this.options.store.create(key, bytes);
    } catch (e) {
      if (
        !(e instanceof AgentError) ||
        !["conflict", "unknown"].includes(e.code)
      )
        throw e;
      const actual = await this.options.store.read(key);
      if (sha256(actual) !== sha256(bytes))
        throw new AgentError("conflict", "Different object won immutable key");
    }
    const readback = await this.options.store.read(key);
    assertBytes(readback, sha256(bytes), bytes.length);
  }
  private async publish(
    manifest: WorkspaceManifest,
    parent: CommittedSnapshot | null,
    blobs: { hash: string; bytes: Uint8Array }[],
    explicit_kind?: CheckpointChange["write_kind"],
  ): Promise<CheckpointResult> {
    validateManifest(manifest);
    const prefix = this.prefix(manifest.workspace_id);
    const manifestBytes = encode(manifest);
    const sequence = parent
      ? (BigInt(parent.sequence) + 1n).toString().padStart(20, "0")
      : "00000000000000000000";
    if (sequence.length !== 20)
      throw new AgentError("capacity", "Commit sequence exhausted");
    const commitKey = prefix + `commits/${sequence}.json`;
    const manifestKey = prefix + `manifests/${manifest.revision}.json`;
    const commit: CommitRecord = {
      schema_version: 1,
      sequence,
      workspace_id: manifest.workspace_id,
      execution_scope: manifest.execution_scope,
      revision: manifest.revision,
      manifest_key: manifestKey,
      manifest_sha256: sha256(manifestBytes),
      parent_commit_key: parent?.commit_key ?? null,
      parent_commit_sha256: parent?.commit_sha256 ?? null,
    };
    const commitBytes = encode(commit);
    const uniqueBlobs = [
      ...new Map(blobs.map((blob) => [blob.hash, blob])).values(),
    ];
    const newHashes = new Set<string>();
    let newBytes = 0;
    for (const blob of uniqueBlobs) {
      try {
        const existing = await this.options.store.stat(
          prefix + "blobs/" + blob.hash,
        );
        if (existing.size !== blob.bytes.length)
          throw new AgentError("corrupt", "Existing blob size mismatch");
      } catch (error) {
        if (!(error instanceof AgentError) || error.code !== "not_found")
          throw error;
        newHashes.add(blob.hash);
        newBytes += blob.bytes.length;
      }
    }
    await this.options.capacity_check?.(
      newBytes + manifestBytes.length + commitBytes.length,
      checkpointWriteKind(manifest, newHashes, explicit_kind),
    );
    for (const b of uniqueBlobs)
      await this.createOrVerify(prefix + "blobs/" + b.hash, b.bytes);
    await this.createOrVerify(manifestKey, manifestBytes);
    try {
      await this.options.store.create(commitKey, commitBytes);
    } catch (e) {
      if (
        !(e instanceof AgentError) ||
        !["conflict", "unknown", "transient"].includes(e.code)
      )
        throw e;
      try {
        const actual = await this.options.store.read(commitKey);
        if (sha256(actual) !== sha256(commitBytes))
          return {
            status: "conflict",
            reason: "Different commit won target sequence",
          };
      } catch (readError) {
        if (readError instanceof AgentError && readError.code === "not_found") {
          try {
            await this.options.store.create(commitKey, commitBytes);
          } catch {
            return {
              status: "unknown",
              reason: "Same immutable intent still unresolved",
              commit_key: commitKey,
            };
          }
        } else
          return {
            status: "unknown",
            reason: "Commit result requires readback reconciliation",
            commit_key: commitKey,
          };
      }
    }
    try {
      assertBytes(
        await this.options.store.read(commitKey),
        sha256(commitBytes),
        commitBytes.length,
      );
    } catch {
      return {
        status: "unknown",
        reason: "Commit verification unavailable",
        commit_key: commitKey,
      };
    }
    const snapshot: CommittedSnapshot = {
      workspace_id: manifest.workspace_id,
      execution_scope: manifest.execution_scope,
      revision: manifest.revision,
      sequence,
      commit_key: commitKey,
      commit_sha256: sha256(commitBytes),
      manifest_key: manifestKey,
      manifest_sha256: sha256(manifestBytes),
      manifest,
    };
    const handle = await this.materialize(snapshot);
    return { status: "committed", handle, snapshot };
  }
}

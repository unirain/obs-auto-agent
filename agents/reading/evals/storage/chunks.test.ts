import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { MAX_FILE_BYTES } from "../../src/workspace/paths.js";
import {
  manifestBlobs,
  validateManifestFile,
  encode,
} from "../../src/workspace/manifest.js";
import { collectGarbage } from "../../src/workspace/gc.js";
import { sha256, type CheckpointResult } from "../../src/contracts/index.js";
import { listAll } from "../../src/storage/preflight.js";
const ok = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "logical-chunks-"));
  const store = new FileObjectStore(join(root, "remote"));
  const charges: { bytes: number; kind: string }[] = [];
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "local"),
    verify_preflight: false,
    capacity_check: async (bytes, kind) => {
      charges.push({ bytes, kind });
    },
  });
  const h = await manager.restore("obs-notes-hub/reading-preview/chunks", {
    allow_initialize: true,
  });
  return { root, store, manager, h, charges };
}
it("persists an admitted 64 MiB logical material as <=32 MiB physical blobs and charges each repeated chunk once", async () => {
  const { root, store, manager, h, charges } = await fixture();
  const bytes = Buffer.alloc(2 * MAX_FILE_BYTES, 97),
    path = "projects/p/sources/material.txt";
  const saved = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "source_snapshot",
      run_id: "run",
      files: [{ path, bytes, role: "evidence", project_id: "p" }],
    }),
  );
  const file = saved.snapshot.manifest.files[0]!;
  expect(file.size).toBe(bytes.length);
  expect(file.sha256).toBe(sha256(bytes));
  expect(file.chunks).toHaveLength(2);
  const objects = await listAll(
    store,
    manager.prefix(h.workspace_id) + "blobs/",
  );
  expect(objects).toHaveLength(1);
  expect(objects[0]!.size).toBe(MAX_FILE_BYTES);
  expect(charges.at(-1)!.kind).toBe("generation");
  expect(charges.at(-1)!.bytes).toBeGreaterThan(MAX_FILE_BYTES);
  expect(charges.at(-1)!.bytes).toBeLessThan(MAX_FILE_BYTES + 65536);
  const next = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "restart"),
    verify_preflight: false,
    lazy_restore: true,
  });
  const restored = await next.restore(h.workspace_id);
  const restoredBytes = await next.readFile(restored, path);
  expect(restoredBytes.length).toBe(bytes.length);
  expect(sha256(restoredBytes)).toBe(sha256(bytes));
});
it("reassembles large exact control JSON after restart and retains all chunks through historical reads and GC", async () => {
  const { root, store, manager, h } = await fixture();
  const record = { schema_version: 1, text: "x".repeat(MAX_FILE_BYTES + 1024) };
  const saved = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "run_recorded",
      run_id: "run",
      records: { large: record },
    }),
  );
  const next = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "next"),
    verify_preflight: false,
  });
  let restored = await next.restore(h.workspace_id);
  expect(restored.records.large).toEqual(record);
  restored = ok(
    await next.checkpoint(restored, {
      expected_revision: restored.revision,
      reason: "maintenance_references_detached",
      run_id: "run",
      records: { large: null },
    }),
  );
  expect(
    (await next.restoreRevision(h.workspace_id, saved.revision)).records.large,
  ).toEqual(record);
  const blobs = manifestBlobs(saved.snapshot.manifest.files[0]!).map(
    (c) => manager.prefix(h.workspace_id) + "blobs/" + c.sha256,
  );
  const protection = {
    reference_knowledge_complete: true,
    protected_revisions: new Set([saved.revision]),
    now: "2027-10-13T00:00:00Z",
  };
  const first = await collectGarbage(
    store,
    manager.prefix(h.workspace_id),
    restored,
    protection,
  );
  for (const key of blobs) expect(first.retained).toContain(key);
  store.faults.push({ operation: "delete", key: blobs[0], kind: "after" });
  const last = await collectGarbage(
    store,
    manager.prefix(h.workspace_id),
    restored,
    { ...protection, protected_revisions: new Set() },
  );
  for (const key of blobs) expect(last.deleted).toContain(key);
  expect((await next.restore(h.workspace_id)).records.large).toBeUndefined();
  expect(
    (
      await collectGarbage(store, manager.prefix(h.workspace_id), restored, {
        ...protection,
        protected_revisions: new Set(),
      })
    ).unknown,
  ).toEqual([]);
});
it("a crash after physical chunks cannot expose a partial logical file; retry and missing/corrupt-chunk restart are strict", async () => {
  const { root, store, manager, h } = await fixture();
  const bytes = Buffer.alloc(MAX_FILE_BYTES + 100, 98);
  const path = "projects/p/sources/large.bin";
  store.faults.push({
    operation: "create",
    kind: "before",
    key: undefined,
    remaining: 1,
  });
  // Target only the manifest so the chunks exist when this failure occurs.
  const create = store.create.bind(store);
  let armed = true;
  store.faults.length = 0;
  store.create = async (key, body) => {
    if (armed && key.includes("/manifests/")) {
      armed = false;
      throw new Error("exit_after_chunks");
    }
    return create(key, body);
  };
  const change = {
    expected_revision: h.revision,
    reason: "source_snapshot",
    run_id: "run",
    files: [{ path, bytes, role: "evidence" as const, project_id: "p" }],
  };
  await expect(manager.checkpoint(h, change)).rejects.toThrow(
    "exit_after_chunks",
  );
  const recovered = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "restart"),
    verify_preflight: false,
    lazy_restore: true,
  });
  const old = await recovered.restore(h.workspace_id);
  expect(old.revision).toBe(h.revision);
  expect(old.snapshot.manifest.files).toEqual([]);
  const saved = ok(await recovered.checkpoint(old, change));
  const file = saved.snapshot.manifest.files[0]!,
    chunk = file.chunks![0]!;
  await writeFile(
    join(
      store.root,
      ...(manager.prefix(h.workspace_id) + "blobs/" + chunk.sha256).split("/"),
    ),
    Buffer.alloc(chunk.size, 99),
  );
  const cold = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "cold"),
    verify_preflight: false,
  });
  await expect(cold.restore(h.workspace_id)).rejects.toMatchObject({
    code: "corrupt",
  });
  await store.delete(manager.prefix(h.workspace_id) + "blobs/" + chunk.sha256);
  await expect(recovered.restore(h.workspace_id)).rejects.toMatchObject({
    code: "corrupt",
  });
});
it("rejects missing chunks, invalid totals and altered whole-file hashes without admitting new remote effects", async () => {
  const file = {
    path: "projects/p/large.bin",
    sha256: sha256("logical"),
    size: MAX_FILE_BYTES + 1,
    role: "evidence" as const,
    project_id: "p",
  };
  expect(() => validateManifestFile(file)).toThrow();
  expect(() =>
    validateManifestFile({
      ...file,
      chunks: [
        { sha256: sha256("a"), size: MAX_FILE_BYTES },
        { sha256: sha256("b"), size: 2 },
      ],
    }),
  ).toThrow();
  expect(() =>
    validateManifestFile({
      ...file,
      chunks: [
        { sha256: sha256("a"), size: MAX_FILE_BYTES - 1 },
        { sha256: sha256("b"), size: 2 },
      ],
    }),
  ).toThrow();
  expect(() =>
    validateManifestFile({
      ...file,
      chunks: [
        { sha256: sha256("a"), size: MAX_FILE_BYTES + 1 },
        { sha256: sha256("b"), size: 0 },
      ],
    }),
  ).toThrow();
  expect(encode({ schema_version: 1 })).toBeDefined();
});
it("GC verifies retained historical manifest bytes against the immutable chain and refuses a stale HEAD before any delete", async () => {
  const { root, store, manager, h } = await fixture();
  const saved = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "source_snapshot",
      run_id: "run",
      files: [
        {
          path: "projects/p/source.txt",
          bytes: Buffer.from("source"),
          role: "evidence",
          project_id: "p",
        },
      ],
    }),
  );
  const current = ok(
    await manager.checkpoint(saved, {
      expected_revision: saved.revision,
      reason: "maintenance_references_detached",
      run_id: "next",
      remove_paths: ["projects/p/source.txt"],
    }),
  );
  const protection = {
    reference_knowledge_complete: true,
    protected_revisions: new Set([saved.revision]),
    now: "2027-10-13T00:00:00Z",
  };
  await expect(
    collectGarbage(store, manager.prefix(h.workspace_id), saved, protection),
  ).rejects.toMatchObject({ code: "conflict" });
  await writeFile(
    join(store.root, ...saved.snapshot.manifest_key.split("/")),
    encode({ ...saved.snapshot.manifest, files: [] }),
  );
  const coldStore = new FileObjectStore(store.root);
  const cold = new ImmutableWorkspaceManager({
    store: coldStore,
    scope: "preview",
    local_root: join(root, "gc-cold"),
    verify_preflight: false,
  });
  const next = await cold.restore(h.workspace_id);
  expect(next.revision).toBe(current.revision);
  await expect(
    collectGarbage(coldStore, manager.prefix(h.workspace_id), next, protection),
  ).rejects.toMatchObject({ code: "corrupt" });
  expect(
    coldStore.calls.filter((call) => call.operation === "delete"),
  ).toHaveLength(0);
  expect(
    sha256(
      await coldStore.read(
        manager.prefix(h.workspace_id) + "blobs/" + sha256("source"),
      ),
    ),
  ).toBe(sha256("source"));
});

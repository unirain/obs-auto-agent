import { describe, it, expect } from "vitest";
import { validateSchema } from "../../src/contracts/schema.js";
import { sha256 } from "../../src/contracts/index.js";
import { advanceCounters, nextBatch } from "../../src/workspace/counters.js";
import { managedInventory } from "../../src/storage/inventory.js";
import {
  reconcileReservation,
  releaseUnwrittenReservation,
  reserve,
} from "../../src/storage/reservations.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { capacityView } from "../../src/storage/capacity.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("exact storage contracts", () => {
  it("rejects unknown envelopes, unknown schema versions and invalid hashes", () => {
    const record = {
      schema_version: 1,
      sequence: "00000000000000000000",
      workspace_id: "obs-notes-hub/reading",
      execution_scope: "production",
      revision: "revision",
      manifest_key: "key",
      manifest_sha256: sha256("manifest"),
      parent_commit_key: null,
      parent_commit_sha256: null,
    };
    expect(validateSchema("checkpoint", record)).toEqual(record);
    for (const bad of [
      { ...record, schema_version: 2 },
      { ...record, additional: "untrusted" },
      { ...record, manifest_sha256: "etag" },
      { ...record, sequence: 0 },
    ])
      expect(() => validateSchema("checkpoint", bad)).toThrow();
    expect(() => validateSchema("unsupported", record)).toThrow();
  });
  it("accumulates guard counters and permits new batches only after committed yield", () => {
    const initial = {
      batch_id: "b1",
      tools: 0,
      materials: 0,
      classifications: 0,
      revisions: 1,
      no_progress: 2,
      total_tools: 4,
      total_materials: 2,
      yield_revision: null,
    };
    const advanced = advanceCounters(initial, {
      tools: 40,
      materials: 8,
      classifications: 1,
    });
    expect(advanced.total_tools).toBe(44);
    expect(() => nextBatch(advanced, "b2", "uncommitted")).toThrow();
    const next = nextBatch(
      { ...advanced, yield_revision: "yield" },
      "b2",
      "yield",
    );
    expect(next.tools).toBe(0);
    expect(next.total_tools).toBe(44);
    expect(next.revisions).toBe(1);
    expect(next.no_progress).toBe(2);
    expect(() => advanceCounters(next, { tools: -1 })).toThrow();
  });
  it("includes every managed historical image version and rejects incomplete providers", async () => {
    const object = {
      bucket: "images",
      key: "img",
      size: 10,
      created_at: "2026-10-13T00:00:00Z",
    };
    const inventory = await managedInventory(
      [],
      [
        {
          inventory: async () => ({
            complete: true,
            objects: [
              { ...object, version: "a" },
              { ...object, version: "b" },
              { ...object, version: "a" },
            ],
          }),
        },
      ],
    );
    expect(inventory).toHaveLength(2);
    expect(capacityView(inventory, []).occupied_bytes).toBe(20);
    await expect(
      managedInventory(
        [],
        [{ inventory: async () => ({ complete: false, objects: [] }) }],
      ),
    ).rejects.toMatchObject({ code: "unknown" });
  });
  it("retains reservation after absent/unknown upload, confirms stable existing key, releases only unwritten", async () => {
    const root = await mkdtemp(join(tmpdir(), "reservation-eval-"));
    const store = new FileObjectStore(join(root, "remote"));
    const r = {
      schema_version: 1 as const,
      reservation_id: "r1",
      execution_scope: "preview" as const,
      bucket: store.bucket,
      key: "image",
      version: null,
      expected_bytes: 3,
      state: "pending" as const,
    };
    expect((await reconcileReservation(store, r)).state).toBe("pending");
    store.faults.push({ operation: "read", key: "image", kind: "before" });
    await store.create("image", Buffer.from("123"));
    expect((await reconcileReservation(store, r)).state).toBe("confirmed");
    await expect(releaseUnwrittenReservation(store, r)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (await releaseUnwrittenReservation(store, { ...r, key: "notwritten" }))
        .state,
    ).toBe("released");
    const manager = new ImmutableWorkspaceManager({
      store,
      scope: "preview",
      local_root: join(root, "local"),
      verify_preflight: false,
    });
    const h = await manager.restore("obs-notes-hub/reading-preview/r", {
      allow_initialize: true,
    });
    const view = capacityView([], []);
    const saved = await reserve(manager, h, r, view, "run");
    expect(saved.status).toBe("committed");
    const restored = await manager.restore(h.workspace_id);
    expect(restored.records["storage/reservations/r1"]).toEqual(r);
  });
});
it("OSS legacy VersionId literal null and absent version refer to the same accounted object", () => {
  const object = {
    bucket: "images",
    key: "image",
    version: "null",
    size: 10,
    created_at: "2026-10-13T00:00:00Z",
  };
  const reservation = {
    schema_version: 1 as const,
    reservation_id: "r",
    execution_scope: "production" as const,
    bucket: "images",
    key: "image",
    version: null,
    expected_bytes: 10,
    state: "confirmed" as const,
  };
  const view = capacityView([object], [reservation]);
  expect(view.occupied_bytes).toBe(10);
  expect(view.reserved_bytes).toBe(0);
});
it("unknown upload into a versioned image bucket is counted once before its version receipt is persisted", () => {
  const object = {
    bucket: "images",
    key: "hash-key",
    version: "opaque-server-version",
    size: 10,
    created_at: "2026-10-13T00:00:00Z",
  };
  const view = capacityView(
    [object],
    [
      {
        schema_version: 1 as const,
        reservation_id: "pending",
        execution_scope: "production",
        bucket: "images",
        key: "hash-key",
        version: null,
        expected_bytes: 10,
        state: "pending",
      },
    ],
  );
  expect(view.occupied_bytes).toBe(10);
  expect(view.reserved_bytes).toBe(0);
});
it("manager centrally enforces invocation envelopes and immutable terminal bindings even through generic business checkpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "record-validation-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "production",
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  let h = await manager.restore("obs-notes-hub/reading", {
    allow_initialize: true,
  });
  const record = {
    schema_version: 1,
    invocation_id: "call",
    execution_scope: "production",
    subject_id: "project:p",
    capability: "research",
    input_hash: sha256("input"),
    context_hash: sha256("ctx"),
    policy_hash: sha256("policy"),
    model: "test",
    sdk_version: "fixture",
    status: "prepared",
    messages: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: null,
      cost_status: "unknown",
    },
    limits: { tools: 40 },
  };
  const change = (value: any) => ({
    expected_revision: h.revision,
    reason: "invocation_observed",
    run_id: "run",
    records: { "invocations/call": value },
  });
  await expect(
    manager.checkpoint(h, change({ ...record, status: "succeeded" })),
  ).rejects.toMatchObject({ code: "corrupt" });
  let result = await manager.checkpoint(h, change(record));
  if (result.status !== "committed") throw new Error(result.status);
  h = result.handle;
  await expect(
    manager.checkpoint(h, change({ ...record, input_hash: sha256("other") })),
  ).rejects.toMatchObject({ code: "corrupt" });
  result = await manager.checkpoint(
    h,
    change({ ...record, status: "unknown" }),
  );
  if (result.status !== "committed") throw new Error(result.status);
  h = result.handle;
  await expect(
    manager.checkpoint(h, change({ ...record, status: "running" })),
  ).rejects.toMatchObject({ code: "corrupt" });
  await expect(manager.checkpoint(h, change(null))).rejects.toMatchObject({
    code: "corrupt",
  });
  expect(
    (await manager.restore(h.workspace_id)).records["invocations/call"],
  ).toMatchObject({ status: "unknown" });
});

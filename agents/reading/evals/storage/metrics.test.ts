import { it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import {
  MeteredObjectStore,
  summarizeStorageOperations,
  inventoryMetrics,
  storageObjectIdentity,
  type StorageOperationEvent,
} from "../../src/storage/metrics.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { WorkspaceJournal } from "../../src/app/journal.js";
it("adapter calls/returned bytes are observed while actual HTTP requests, wire traffic and money remain unknown without transport evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "store-metrics-"));
  const inner = new FileObjectStore(join(root, "objects"));
  const store = new MeteredObjectStore(inner, {
    run_id: "run",
    execution_scope: "preview",
    storage_role: "workspace",
  });
  inner.faults.push({ operation: "create", key: "test/data", kind: "after" });
  await expect(
    store.create("test/data", Buffer.from("abc")),
  ).rejects.toMatchObject({ code: "unknown" });
  expect(Buffer.from(await store.read("test/data")).toString()).toBe("abc");
  const metrics = store.snapshot();
  expect(metrics.adapter_calls).toBe(2);
  expect(metrics.by_operation).toMatchObject({ create: 1, read: 1 });
  expect(metrics.supplied_payload_bytes).toBe(3);
  expect(metrics.returned_payload_bytes).toBe(3);
  expect(metrics.unknown_outcomes).toBe(1);
  expect(metrics.service_requests).toBeNull();
  expect(metrics.wire_bytes_sent).toBeNull();
  expect(metrics.money.amount_usd).toBeNull();
  expect(metrics.observability).toBe("adapter_only");
  const manager = new ImmutableWorkspaceManager({
    store: inner,
    scope: "preview",
    local_root: join(root, "first"),
    verify_preflight: false,
  });
  const journal = new WorkspaceJournal(
    manager,
    await manager.restore("obs-notes-hub/reading-preview/metrics", {
      allow_initialize: true,
    }),
    "run",
  );
  await journal.commitMany(
    {
      "storage/metrics/run": metrics,
      "storage/metric-events/run": store.observations(),
    },
    "run_recorded",
  );
  const fresh = new ImmutableWorkspaceManager({
    store: new FileObjectStore(inner.root),
    scope: "preview",
    local_root: join(root, "next"),
    verify_preflight: false,
  });
  const h = await fresh.restore(journal.handle.workspace_id);
  const events = h.records[
    "storage/metric-events/run"
  ] as unknown as StorageOperationEvent[];
  const recovered = summarizeStorageOperations(
    [...events, events[0]!],
    { run_id: "run", execution_scope: "preview", storage_role: "workspace" },
    inner.bucket,
  );
  expect(recovered.adapter_calls).toBe(2);
  expect(recovered.service_requests).toBeNull();
});
it("explicit partial transport observations keep unknown total and known lower bound rather than inventing zero requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "partial-transport-"));
  let count = 0;
  const store = new MeteredObjectStore(
    new FileObjectStore(join(root, "objects")),
    { run_id: "run", execution_scope: "production", storage_role: "workspace" },
    () =>
      ++count === 1
        ? {
            service_requests: 1,
            wire_bytes_sent: 100,
            wire_bytes_received: 200,
            retries: 0,
          }
        : {
            service_requests: null,
            wire_bytes_sent: null,
            wire_bytes_received: null,
            retries: null,
          },
  );
  await store.create("key", Buffer.from("content"));
  await store.read("key");
  const view = store.snapshot();
  expect(view.service_requests).toBeNull();
  expect(view.known_service_requests).toBe(1);
  expect(view.wire_bytes_received).toBeNull();
  expect(view.known_wire_bytes_received).toBe(200);
  expect(view.observability).toBe("partial_transport");
});
it("capacity breakdown counts real copies/versions, separates unknown orphan references and does not infer historical versions without latest markers", () => {
  const base = { created_at: "2026-10-13T00:00:00Z" };
  const objects = [
    { ...base, bucket: "private", key: "prod/w/commits/000.json", size: 2 },
    { ...base, bucket: "private", key: "prod/w/manifests/rev.json", size: 3 },
    { ...base, bucket: "private", key: "prod/w/blobs/hash", size: 5 },
    { ...base, bucket: "private", key: "preview/w/blobs/hash", size: 5 },
    {
      ...base,
      bucket: "images",
      key: "managed/p/image",
      version: "v1",
      size: 7,
      is_latest: false,
    },
    {
      ...base,
      bucket: "images",
      key: "managed/p/image",
      version: "v2",
      size: 7,
      is_latest: true,
    },
  ];
  const bindings = [
    {
      bucket: "private",
      prefix: "prod/",
      kind: "workspace" as const,
      execution_scope: "production" as const,
    },
    {
      bucket: "private",
      prefix: "preview/",
      kind: "workspace" as const,
      execution_scope: "preview" as const,
    },
    {
      bucket: "images",
      prefix: "managed/",
      kind: "image" as const,
      execution_scope: "shared" as const,
    },
  ];
  const unknown = inventoryMetrics({
    objects: [...objects, objects[5]!],
    complete: true,
    bindings,
    references_complete: false,
  });
  expect(unknown.total_bytes).toBe(29);
  expect(unknown.object_versions).toBe(6);
  expect(unknown.unique_keys).toBe(5);
  expect(unknown.additional_versions).toBe(1);
  expect(unknown.historical_versions).toBeNull();
  expect(unknown.categories.unclassified_blobs.bytes).toBe(10);
  expect(unknown.categories.orphan_blobs.bytes).toBe(0);
  expect(unknown.by_scope).toMatchObject({
    production: { bytes: 10 },
    preview: { bytes: 5 },
    shared: { bytes: 14 },
  });
  const referenced = new Set([storageObjectIdentity(objects[2]!)]);
  const known = inventoryMetrics({
    objects,
    complete: true,
    bindings,
    referenced_objects: referenced,
    references_complete: true,
    historical_versions_known: true,
  });
  expect(known.categories.referenced_blobs.bytes).toBe(5);
  expect(known.categories.orphan_blobs.bytes).toBe(5);
  expect(known.historical_versions).toBeNull();
  expect(() =>
    inventoryMetrics({
      objects,
      complete: false,
      bindings,
      references_complete: false,
    }),
  ).toThrow("partial inventory");
});

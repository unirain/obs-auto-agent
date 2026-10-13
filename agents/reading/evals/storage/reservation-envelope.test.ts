import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  sha256,
  type CheckpointResult,
  type JsonValue,
} from "../../src/contracts/index.js";
import {
  parseStorageReservation,
  capacityView,
} from "../../src/storage/capacity.js";
import {
  reconcileReservation,
  releaseUnwrittenReservation,
  reserve,
} from "../../src/storage/reservations.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { encode } from "../../src/workspace/manifest.js";
const reservation = {
  schema_version: 1 as const,
  reservation_id: "r",
  execution_scope: "preview" as const,
  bucket: "local-protocol-test",
  key: "images/r",
  version: null,
  expected_bytes: 3,
  state: "pending" as const,
};
const invalidEnvelopes = () => {
  const { schema_version: _, ...unversioned } = reservation;
  return [
    unversioned,
    { ...reservation, schema_version: 2 },
    { ...reservation, extra: true },
    { ...reservation, version: undefined },
    { ...reservation, expected_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...reservation, state: "unknown" },
    { ...reservation, reservation_id: "../r" },
  ];
};
const committed = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reservation-envelope-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  const handle = await manager.restore(
    "obs-notes-hub/reading-preview/reservation",
    { allow_initialize: true },
  );
  return { root, store, manager, handle };
}
it("requires exact version 1 before capacity accounting, any adapter read or reservation checkpoint", async () => {
  const { store, manager, handle } = await fixture();
  const before = store.calls.length;
  for (const bad of invalidEnvelopes()) {
    expect(() => parseStorageReservation(bad)).toThrow();
    expect(() => capacityView([], [bad as any])).toThrow();
    await expect(reconcileReservation(store, bad as any)).rejects.toMatchObject(
      { code: "corrupt" },
    );
    await expect(
      releaseUnwrittenReservation(store, bad as any),
    ).rejects.toMatchObject({ code: "corrupt" });
    await expect(
      reserve(manager, handle, bad as any, capacityView([], []), "run"),
    ).rejects.toMatchObject({ code: "corrupt" });
  }
  expect(store.calls).toHaveLength(before);
});
it("persistent versioned reservation preserves binding and lifecycle through a fresh FileStore process", async () => {
  const { root, store, manager, handle } = await fixture();
  let h = committed(
    await reserve(manager, handle, reservation, capacityView([], []), "run"),
  );
  const change = (value: unknown) => ({
    expected_revision: h.revision,
    run_id: "run",
    reason: "storage_reconciled",
    records: { "storage/reservations/r": value as JsonValue },
  });
  for (const bad of [
    ...invalidEnvelopes(),
    { ...reservation, key: "images/other" },
    { ...reservation, execution_scope: "production" },
  ])
    await expect(manager.checkpoint(h, change(bad))).rejects.toThrow();
  await expect(
    manager.checkpoint(h, {
      expected_revision: h.revision,
      run_id: "run",
      reason: "storage_reconciled",
      files: [
        {
          path: "state/storage/reservations/r.json",
          role: "control",
          bytes: encode({ ...reservation, schema_version: 2 }),
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  await store.create(reservation.key, Buffer.from("123"));
  const confirmed = await reconcileReservation(store, reservation);
  h = committed(await manager.checkpoint(h, change(confirmed)));
  await expect(
    manager.checkpoint(h, change(reservation)),
  ).rejects.toMatchObject({ code: "corrupt" });
  const restarted = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "next"),
    verify_preflight: false,
  });
  const restored = await restarted.restore(h.workspace_id);
  expect(
    parseStorageReservation(restored.records["storage/reservations/r"]),
  ).toEqual(confirmed);
  expect(
    capacityView(
      [
        {
          bucket: store.bucket,
          key: reservation.key,
          size: 3,
          created_at: new Date().toISOString(),
        },
      ],
      [confirmed],
    ).reserved_bytes,
  ).toBe(0);
  await expect(manager.checkpoint(h, change(null))).rejects.toMatchObject({
    code: "corrupt",
  });
});
it.each([undefined, 2])(
  "refuses a valid immutable chain containing reservation version %s after restart",
  async (version) => {
    const { root, store, manager, handle: h } = await fixture();
    const old = { ...reservation } as Record<string, unknown>;
    if (version === undefined) delete old.schema_version;
    else old.schema_version = version;
    const bytes = encode(old),
      hash = sha256(bytes),
      prefix = manager.prefix(h.workspace_id);
    await store.create(prefix + "blobs/" + hash, bytes);
    const revision = "future-record";
    const manifest = {
      ...h.snapshot.manifest,
      revision,
      parent_revision: h.revision,
      checkpoint_reason: "storage_reserved",
      files: [
        {
          path: "state/storage/reservations/r.json",
          sha256: hash,
          size: bytes.length,
          role: "control",
          project_id: null,
        },
      ],
    };
    const manifestBytes = encode(manifest),
      manifestKey = prefix + "manifests/" + revision + ".json";
    await store.create(manifestKey, manifestBytes);
    const sequence = String(BigInt(h.snapshot.sequence) + 1n).padStart(20, "0");
    const commit = {
      ...JSON.parse(
        Buffer.from(await store.read(h.snapshot.commit_key)).toString("utf8"),
      ),
      sequence,
      revision,
      manifest_key: manifestKey,
      manifest_sha256: sha256(manifestBytes),
      parent_commit_key: h.snapshot.commit_key,
      parent_commit_sha256: h.snapshot.commit_sha256,
    };
    await store.create(
      prefix + "commits/" + sequence + ".json",
      encode(commit),
    );
    const next = new ImmutableWorkspaceManager({
      store: new FileObjectStore(store.root),
      scope: "preview",
      local_root: join(root, "recovery"),
      verify_preflight: false,
    });
    await expect(next.restore(h.workspace_id)).rejects.toMatchObject({
      code: "corrupt",
    });
    expect(await store.read(prefix + "commits/" + sequence + ".json")).toEqual(
      encode(commit),
    );
  },
);

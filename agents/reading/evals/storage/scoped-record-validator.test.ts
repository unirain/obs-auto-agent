import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  AgentError,
  canonicalJson,
  type JsonValue,
  type CheckpointResult,
  type ScopedRecordValidator,
} from "../../src/contracts/index.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { encode } from "../../src/workspace/manifest.js";
const id = "obs-notes-hub/reading-preview/host-hook";
const ok = (result: CheckpointResult) => {
  if (result.status !== "committed") throw new Error(result.status);
  return result.handle;
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "scoped-validator-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "loose"),
    verify_preflight: false,
  });
  const h = await manager.restore(id, { allow_initialize: true });
  return { root, store, manager, h };
}
const row = (ref?: string) => ({
  schema_version: 1,
  scope: "preview",
  workspace_id: id,
  ...(ref ? { context_id: ref } : {}),
});
function hostValidator(
  observed?: Record<string, JsonValue | null>[],
): ScopedRecordValidator {
  return (records, scope, workspaceId) => {
    expect(scope).toBe("preview");
    expect(workspaceId).toBe(id);
    observed?.push(JSON.parse(canonicalJson(records)));
    for (const [key, value] of Object.entries(records)) {
      if (!key.startsWith("host-") || value === null) continue;
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        value.schema_version !== 1 ||
        value.scope !== scope ||
        value.workspace_id !== workspaceId
      )
        throw new AgentError("corrupt", "Invalid host envelope");
      if (
        key.startsWith("host-projects/") &&
        (!value.context_id ||
          !records["host-contexts/" + String(value.context_id)])
      )
        throw new AgentError("corrupt", "Referenced context absent");
    }
  };
}
it("instance hook sees merged records, raw control files, deletions and identity before any remote create", async () => {
  const { root, store, h } = await fixture();
  const observed: Record<string, JsonValue | null>[] = [];
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "strict"),
    verify_preflight: false,
    record_validator: hostValidator(observed),
  });
  let current = await manager.restore(id);
  current = ok(
    await manager.checkpoint(current, {
      expected_revision: current.revision,
      run_id: "run",
      reason: "project_created",
      records: {
        "host-contexts/ctx": row(),
        "host-projects/p": row("ctx"),
        keep: { schema_version: 1, retained: true },
      },
    }),
  );
  let before = store.calls.filter((call) => call.operation === "create").length;
  await expect(
    manager.checkpoint(current, {
      expected_revision: current.revision,
      run_id: "run",
      reason: "maintenance_references_detached",
      records: { "host-contexts/ctx": null },
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  await expect(
    manager.checkpoint(current, {
      expected_revision: current.revision,
      run_id: "run",
      reason: "run_recorded",
      files: [
        {
          path: "state/host-projects/p.json",
          bytes: encode({ ...row("ctx"), schema_version: 2 }),
          role: "control",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  expect(
    store.calls.filter((call) => call.operation === "create"),
  ).toHaveLength(before);
  current = ok(
    await manager.checkpoint(current, {
      expected_revision: current.revision,
      run_id: "run",
      reason: "maintenance_references_detached",
      records: { "host-projects/p": null },
      remove_paths: ["state/host-contexts/ctx.json"],
    }),
  );
  expect(
    observed.some(
      (records) =>
        records["host-contexts/ctx"] === null &&
        records["host-projects/p"] === null &&
        records.keep !== undefined,
    ),
  ).toBe(true);
  expect(current.records).toEqual({
    keep: { schema_version: 1, retained: true },
  });
  const next = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "next"),
    verify_preflight: false,
    record_validator: hostValidator(),
  });
  expect((await next.restore(id)).records).toEqual(current.records);
  expect(h.snapshot.manifest.files).toEqual([]);
});
it("bad control envelopes persist only in the unguarded instance; cold guarded restore and historical restore reject them", async () => {
  const { root, store, manager, h } = await fixture();
  const bad = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "run_recorded",
      run_id: "old",
      records: { "host-contexts/ctx": { ...row(), schema_version: 2 } },
    }),
  );
  const strict = () =>
    new ImmutableWorkspaceManager({
      store: new FileObjectStore(store.root),
      scope: "preview",
      local_root: join(root, "guarded"),
      verify_preflight: false,
      record_validator: hostValidator(),
    });
  await expect(strict().restore(id)).rejects.toMatchObject({ code: "corrupt" });
  expect((await manager.restore(id)).records["host-contexts/ctx"]).toEqual({
    ...row(),
    schema_version: 2,
  });
  const good = ok(
    await manager.checkpoint(bad, {
      expected_revision: bad.revision,
      reason: "run_recorded",
      run_id: "new",
      records: { "host-contexts/ctx": row() },
    }),
  );
  const next = strict();
  expect((await next.restore(id)).revision).toBe(good.revision);
  await expect(next.restoreRevision(id, bad.revision)).rejects.toMatchObject({
    code: "corrupt",
  });
  const historical = await manager.restoreRevision(id, bad.revision);
  expect(historical.records["host-contexts/ctx"]).toEqual({
    ...row(),
    schema_version: 2,
  });
});
it("null record and raw control file cannot silently recreate a deleted record", async () => {
  const { store, manager, h } = await fixture();
  const before = store.calls.filter(
    (call) => call.operation === "create",
  ).length;
  await expect(
    manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "run_recorded",
      run_id: "run",
      records: { "host-contexts/ctx": null },
      files: [
        {
          path: "state/host-contexts/ctx.json",
          bytes: encode(row()),
          role: "control",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  expect(
    store.calls.filter((call) => call.operation === "create"),
  ).toHaveLength(before);
});
it("initialization cannot write a commit before the host validator admits the empty workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "host-initialize-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "strict"),
    verify_preflight: false,
    record_validator: () => {
      throw new AgentError("configuration", "Initialization disallowed");
    },
  });
  await expect(
    manager.restore(id, { allow_initialize: true }),
  ).rejects.toMatchObject({ code: "configuration" });
  expect(
    store.calls.filter((call) => call.operation === "create"),
  ).toHaveLength(0);
});

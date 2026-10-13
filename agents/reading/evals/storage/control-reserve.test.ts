import { it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { assertCapacity, capacityView } from "../../src/storage/capacity.js";
import {
  sha256,
  type InvocationRecord,
  type CheckpointResult,
} from "../../src/contracts/index.js";
const committed = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
it("at49GB control receipts/detach fit last1GB but freshcandidate/artifact and unknown event admission are refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "control-reserve-"));
  const store = new FileObjectStore(join(root, "remote"));
  let occupied = 0;
  const kinds: string[] = [];
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "production",
    local_root: join(root, "local"),
    verify_preflight: false,
    capacity_check: async (bytes, kind) => {
      kinds.push(kind);
      const view = capacityView(
        [
          {
            bucket: "synthetic",
            key: "occupied",
            size: occupied,
            created_at: "2026-10-13T00:00:00Z",
          },
        ],
        [],
      );
      assertCapacity(view, bytes, kind);
      occupied += bytes;
    },
  });
  let handle = await manager.restore("obs-notes-hub/reading", {
    allow_initialize: true,
  });
  occupied = 49_000_000_000;
  const invocation: InvocationRecord = {
    schema_version: 1,
    invocation_id: "i",
    execution_scope: "production",
    subject_id: "project:p",
    capability: "research",
    input_hash: sha256("in"),
    context_hash: sha256("ctx"),
    policy_hash: sha256("policy"),
    model: "fixture",
    sdk_version: "fixture",
    status: "prepared",
    messages: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: null,
      cost_status: "unknown",
    },
    limits: {},
  };
  handle = committed(
    await manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "invocation_prepared",
      run_id: "run",
      records: { "invocations/i": invocation as any },
    }),
  );
  expect(kinds.at(-1)).toBe("control");
  handle = committed(
    await manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "maintenance_references_detached",
      run_id: "run",
      records: { maintenance: { detached: true } },
    }),
  );
  expect(kinds.at(-1)).toBe("control");
  await expect(
    manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "collection_committed",
      run_id: "run",
      write_kind: "control",
      records: { candidates: [{ url: "https://example.org/new" }] },
    }),
  ).rejects.toMatchObject({ code: "capacity" });
  await expect(
    manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "invocation_observed",
      run_id: "run",
      write_kind: "control",
      files: [
        {
          path: "projects/p/draft/new.md",
          bytes: Buffer.from("new generation"),
          role: "artifact",
          project_id: "p",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "capacity" });
  await expect(
    manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "unregistered_event",
      run_id: "run",
      records: { state: { value: "new" } },
    }),
  ).rejects.toMatchObject({ code: "capacity" });
  occupied = 50_000_000_000;
  await expect(
    manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "delivery_recorded",
      run_id: "run",
      records: { delivery: { pr: 1 } },
    }),
  ).rejects.toMatchObject({ code: "capacity" });
  expect(
    (await manager.restore(handle.workspace_id)).records.maintenance,
  ).toEqual({ detached: true });
});

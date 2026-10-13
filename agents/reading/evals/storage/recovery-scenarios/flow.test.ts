import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { FileObjectStore } from "../../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../../src/workspace/manager.js";
import {
  PersistentInvocationJournal,
  recoveredInvocations,
} from "../../../src/workspace/invocations.js";
import { sealDelivery } from "../../../src/workspace/seal.js";
import {
  sha256,
  type CheckpointResult,
  type WorkspaceHandle,
  type InvocationRecord,
} from "../../../src/contracts/index.js";
const committed = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
it("atomic discovery → paid intent → artifacts → seal → remote-success receipt failure → reconciliation next run", async () => {
  const root = await mkdtemp(join(tmpdir(), "storage-flow-"));
  const store = new FileObjectStore(join(root, "remote"), 1);
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "production",
    local_root: join(root, "first"),
    verify_preflight: false,
  });
  const id = "obs-notes-hub/reading";
  let handle = await manager.restore(id, { allow_initialize: true });
  let paidCalls = 0;
  let remoteWrites = 0;
  let pr: string | null = null;
  const save = (
    h: WorkspaceHandle,
    records: Record<string, any>,
    reason: string,
  ) =>
    manager.checkpoint(h, {
      expected_revision: h.revision,
      reason,
      run_id: "test",
      records,
    });
  handle = committed(
    await save(
      handle,
      {
        sources: { cursor: "page-2" },
        candidates: [{ id: "article", url: "https://example.org/article" }],
      },
      "collection_committed",
    ),
  );
  const journal = new PersistentInvocationJournal(manager);
  const invocation: InvocationRecord = {
    schema_version: 1,
    invocation_id: "research",
    execution_scope: "production",
    subject_id: "p",
    capability: "research",
    input_hash: sha256("article"),
    context_hash: sha256("context"),
    policy_hash: sha256("policy"),
    model: "fake",
    sdk_version: "fixture",
    status: "prepared",
    messages: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cost_status: "unknown",
      cost_usd: null,
    },
    limits: { tools: 40 },
  };
  handle = committed(await journal.prepare(handle, invocation, "test"));
  paidCalls++;
  handle = committed(
    await journal.observe(
      handle,
      "research",
      {
        message_id: "result",
        summary: true,
        usage: {
          input_tokens: 42,
          output_tokens: 10,
          cost_status: "known",
          cost_usd: 0.1,
        },
      },
      "test",
    ),
  );
  handle = committed(
    await journal.finish(handle, "research", "succeeded", "test"),
  );
  handle = committed(
    await manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason: "stage_completed",
      run_id: "test",
      records: { projects: { p: { stage: "reviewed" } } },
      files: [
        {
          path: "projects/p/draft/note.md",
          role: "artifact",
          project_id: "p",
          bytes: Buffer.from("Supported mechanism and cited evidence"),
        },
      ],
    }),
  );
  const sealedRevision = handle.revision;
  const seal = await sealDelivery(handle, "p", {
    review_passed: true,
    program_checks_passed: true,
    input_revision: handle.revision,
    resources: [],
  });
  handle = committed(
    await save(
      handle,
      {
        deliveries: {
          delivery_id: "delivery",
          status: "publishing",
          sealed_revision: seal.workspace_revision,
        },
      },
      "delivery_prepared",
    ),
  );
  remoteWrites++;
  pr = "test-pr-1";
  const nextKey =
    manager.prefix(id) +
    "commits/" +
    (BigInt(handle.snapshot.sequence) + 1n).toString().padStart(20, "0") +
    ".json";
  store.faults.push({ operation: "create", key: nextKey, kind: "permission" });
  await expect(
    save(
      handle,
      {
        deliveries: { delivery_id: "delivery", status: "awaiting_review", pr },
      },
      "delivery_recorded",
    ),
  ).rejects.toMatchObject({ code: "permission" });
  const nextManager = new ImmutableWorkspaceManager({
    store: new FileObjectStore(join(root, "remote"), 1),
    scope: "production",
    local_root: join(root, "next"),
    verify_preflight: false,
  });
  handle = await nextManager.restore(id);
  expect(handle.records.sources).toEqual({ cursor: "page-2" });
  expect(handle.records.candidates).toHaveLength(1);
  expect(recoveredInvocations(handle)[0]?.status).toBe("succeeded");
  expect(handle.records.deliveries).toMatchObject({ status: "publishing" });
  const historical = await nextManager.restoreRevision(id, sealedRevision);
  expect(
    historical.snapshot.manifest.files.some((f) => f.path.endsWith("note.md")),
  ).toBe(true);
  /* External fact is authoritative: reconcile, never create again. */ handle =
    committed(
      await nextManager.checkpoint(handle, {
        expected_revision: handle.revision,
        reason: "delivery_reconciled",
        run_id: "next",
        records: {
          deliveries: {
            delivery_id: "delivery",
            status: "awaiting_review",
            pr,
          },
        },
      }),
    );
  expect(handle.records.deliveries).toMatchObject({ pr: "test-pr-1" });
  expect(paidCalls).toBe(1);
  expect(remoteWrites).toBe(1);
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { PersistentInvocationJournal } from "../../src/workspace/invocations.js";
import {
  buildUsageLedger,
  usageForRun,
  usageForProject,
  detailedUsage,
  aggregateUsage,
} from "../../src/workspace/usage.js";
import {
  sha256,
  canonicalJson,
  type InvocationRecord,
  type WorkspaceHandle,
  type CheckpointResult,
} from "../../src/contracts/index.js";
const committed = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
const usage = (input: number, output: number, cost: number | null) => ({
  input_tokens: input,
  output_tokens: output,
  cost_usd: cost,
  cost_status: cost === null ? ("unknown" as const) : ("known" as const),
});
const receipt = (
  id: string,
  scope: "production" | "preview",
  subject = "project:article",
): InvocationRecord => ({
  schema_version: 1,
  invocation_id: id,
  execution_scope: scope,
  subject_id: subject,
  capability: "research",
  input_hash: sha256("input"),
  context_hash: sha256("context"),
  policy_hash: sha256("policy"),
  model: "fixture",
  sdk_version: "fixture",
  status: "prepared",
  messages: [],
  usage: usage(0, 0, null),
  limits: { tools: 40 },
});
async function workspace(scope: "production" | "preview", root: string) {
  const store = new FileObjectStore(join(root, "objects"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope,
    local_root: join(root, "run"),
    verify_preflight: false,
  });
  const id =
    scope === "production"
      ? "obs-notes-hub/reading"
      : "obs-notes-hub/reading-preview/test";
  return {
    store,
    manager,
    handle: await manager.restore(id, { allow_initialize: true }),
  };
}
it("FileStore restart preserves one query, deduplicates message replay, uses cumulative summary once and partitions run/day/project/scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-ledger-"));
  const prod = await workspace("production", root);
  let h = prod.handle;
  const journal = new PersistentInvocationJournal(prod.manager);
  h = committed(
    await journal.prepare(h, receipt("shared-id", "production"), "run-old"),
  );
  h = committed(
    await prod.manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "invocation_prepared",
      run_id: "run-old",
      records: {
        "invocations/shared-id": h.records["receipts/shared-id"]!,
        "invocation_meta/shared-id": {
          run_id: "run-old",
          started_at: "2026-10-13T15:59:59Z",
          purpose: "format_repair",
          pricing_version: "test-price-v1",
        },
      },
    }),
  );
  h = committed(
    await journal.observe(
      h,
      "shared-id",
      { message_id: "step", summary: false, usage: usage(10, 2, 0.5) },
      "run-old",
    ),
  );
  h = committed(
    await journal.observe(
      h,
      "shared-id",
      { message_id: "total", summary: true, usage: usage(30, 6, 1.5) },
      "run-old",
    ),
  );
  const restarted = new ImmutableWorkspaceManager({
    store: new FileObjectStore(prod.store.root),
    scope: "production",
    local_root: join(root, "fresh"),
    verify_preflight: false,
  });
  h = await restarted.restore(h.workspace_id);
  const next = new PersistentInvocationJournal(restarted);
  const revision = h.revision;
  h = committed(
    await next.observe(
      h,
      "shared-id",
      JSON.parse(
        canonicalJson({
          message_id: "total",
          summary: true,
          usage: usage(30, 6, 1.5),
        }),
      ),
      "run-new",
    ),
  );
  expect(h.revision).toBe(revision);
  h = committed(await next.finish(h, "shared-id", "succeeded", "run-new"));
  // A consistent legacy alias is the same invocation, not a second paid query.
  const data = h.records["receipts/shared-id"];
  h = committed(
    await restarted.checkpoint(h, {
      expected_revision: h.revision,
      reason: "invocation_finished",
      run_id: "run-new",
      records: { "invocations/shared-id": data! },
    }),
  );
  const preview = await workspace("preview", root);
  let ph = preview.handle;
  const pj = new PersistentInvocationJournal(preview.manager);
  ph = committed(
    await pj.prepare(ph, receipt("shared-id", "preview"), "preview-run"),
  );
  ph = committed(
    await preview.manager.checkpoint(ph, {
      expected_revision: ph.revision,
      reason: "invocation_prepared",
      run_id: "preview-run",
      records: {
        "invocation_meta/shared-id": {
          run_id: "preview-run",
          started_at: "2026-10-13T16:00:00Z",
        },
      },
    }),
  );
  ph = committed(
    await pj.observe(
      ph,
      "shared-id",
      { message_id: "total", summary: true, usage: usage(8, 1, null) },
      "preview-run",
    ),
  );
  ph = committed(await pj.finish(ph, "shared-id", "succeeded", "preview-run"));
  const ledger = buildUsageLedger([h, ph]);
  expect(ledger.total.invocation_count).toBe(2);
  expect(ledger.total.cost_usd).toBeNull();
  expect(ledger.total.known_cost_usd).toBe(1.5);
  expect(ledger.total.input_tokens).toBe(38);
  expect(ledger.by_scope.production.cost_usd).toBe(1.5);
  expect(ledger.by_scope.preview.cost_usd).toBeNull();
  expect(
    usageForRun(ledger, "production", h.workspace_id, "run-new")
      .invocation_count,
  ).toBe(0);
  expect(
    usageForRun(ledger, "production", h.workspace_id, "run-old").cost_usd,
  ).toBe(1.5);
  expect(
    usageForProject(ledger, "preview", ph.workspace_id, "article").cost_usd,
  ).toBeNull();
  expect(ledger.by_day.map((g) => g.key).sort()).toEqual([
    "2026-10-13",
    "2026-10-14",
  ]);
  expect(
    ledger.by_purpose.find((g) => g.key === "format_repair")?.totals.cost_usd,
  ).toBe(1.5);
});
it("unknown final result retains priced lower bound and known tokens; missing metadata stays unattributed rather than guessing next run", async () => {
  const root = await mkdtemp(join(tmpdir(), "unknown-usage-"));
  const { manager, handle } = await workspace("production", root);
  const journal = new PersistentInvocationJournal(manager);
  let h = committed(
    await journal.prepare(
      handle,
      receipt("uncertain", "production", "candidate:unassigned"),
      "run",
    ),
  );
  h = committed(
    await journal.observe(
      h,
      "uncertain",
      { message_id: "priced", summary: true, usage: usage(17, 5, 0.75) },
      "run",
    ),
  );
  h = committed(
    await journal.observe(
      h,
      "uncertain",
      { message_id: "unpriced", summary: true, usage: usage(0, 0, null) },
      "run",
    ),
  );
  h = committed(await journal.finish(h, "uncertain", "unknown", "run"));
  h = committed(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "invocation_reconciled",
      run_id: "legacy",
      records: { "invocation_meta/uncertain": null },
    }),
  );
  h = await manager.restore(h.workspace_id);
  const ledger = buildUsageLedger([h]);
  expect(ledger.total.cost_usd).toBeNull();
  expect(ledger.total.known_cost_usd).toBe(0.75);
  expect(ledger.total.input_tokens).toBe(17);
  expect(ledger.total.token_status).toBe("partial");
  expect(ledger.total.unresolved_invocations).toBe(1);
  expect(ledger.by_run).toEqual([]);
  expect(ledger.by_day).toEqual([]);
  expect(ledger.unattributed[0]?.missing).toEqual([
    "run_id",
    "started_at",
    "project_id",
  ]);
});
it("query-wide summary includes step observations regardless of message arrival order", () => {
  const messages = [
    { message_id: "step", summary: false, usage: usage(4, 1, 0.2) },
    { message_id: "summary", summary: true, usage: usage(10, 2, 0.5) },
    { message_id: "later", summary: false, usage: usage(3, 1, 0.1) },
  ];
  expect(detailedUsage(messages)).toMatchObject({
    input_tokens: 10,
    output_tokens: 2,
    cost_usd: 0.5,
    known_cost_usd: 0.5,
    token_status: "known",
  });
  expect(
    aggregateUsage([...messages, JSON.parse(canonicalJson(messages[2]!))]),
  ).toMatchObject({ cost_usd: 0.5 });
  expect(() =>
    aggregateUsage([
      ...messages,
      { ...messages[2]!, usage: usage(99, 1, 0.1) },
    ]),
  ).toThrow("Replayed usage message changed");
});
it("an unpriced zero-token event without a query summary is unknown, and missing run/project attribution never becomes a false zero", async () => {
  expect(
    aggregateUsage([
      { message_id: "known", summary: false, usage: usage(4, 1, 0.1) },
      { message_id: "missing", summary: false, usage: usage(0, 0, null) },
    ]).cost_usd,
  ).toBeNull();
  const root = await mkdtemp(join(tmpdir(), "unattributed-"));
  const { manager, handle } = await workspace("production", root);
  const journal = new PersistentInvocationJournal(manager);
  let h = committed(
    await journal.prepare(
      handle,
      receipt("call", "production", "candidate:unknown"),
      "run",
    ),
  );
  h = committed(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "invocation_reconciled",
      run_id: "legacy",
      records: { "invocation_meta/call": null },
    }),
  );
  const ledger = buildUsageLedger([h]);
  expect(
    usageForRun(ledger, "production", h.workspace_id, "next"),
  ).toMatchObject({
    cost_usd: null,
    cost_status: "unknown",
    attribution_complete: false,
    unattributed_invocations: 1,
  });
  expect(
    usageForProject(ledger, "production", h.workspace_id, "article"),
  ).toMatchObject({ cost_usd: null, attribution_complete: false });
});

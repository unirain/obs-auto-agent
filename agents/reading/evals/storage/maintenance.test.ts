import { it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { WorkspaceJournal } from "../../src/app/journal.js";
import { maintainWorkspace } from "../../src/app/maintenance.js";
import { sha256, type InvocationRecord } from "../../src/contracts/index.js";
import { listAll } from "../../src/storage/preflight.js";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "maintenance-eval-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "first"),
    verify_preflight: false,
    lazy_restore: true,
  });
  const id = "obs-notes-hub/reading-preview/maintenance";
  const journal = new WorkspaceJournal(
    manager,
    await manager.restore(id, { allow_initialize: true }),
    "run1",
  );
  const project = {
    schema_version: 1,
    project_id: "p",
    workspace_id: id,
    execution_scope: "preview",
    state: "preview_ready",
    generation_version: 1,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-08-01T00:00:00Z",
    candidate: {
      candidate_id: "c",
      url: "https://example.org/article",
      title: "Mechanism",
      status: "preview_ready",
    },
    context: {
      context_id: "ctx",
      skill_commit: "a".repeat(40),
      example_texts: { private: "fixed examples" },
    },
    snapshots: [
      {
        text: "private original source",
        hash: sha256("private original source"),
      },
    ],
    research: {
      knowledge_increment: "New supported mechanism",
      evidence: [{ excerpt: "private research" }],
    },
    writing: { markdown: "private note" },
    delivery_id: null,
  };
  await journal.commitMany(
    {
      "projects/p": project,
      "contexts/ctx": project.context,
      identity: { cursor: "committed", candidate_id: "c" },
    },
    "project_completed",
    [
      {
        path: "projects/p/sources/original.txt",
        bytes: Buffer.from("private original source"),
        role: "evidence",
        project_id: "p",
      },
      {
        path: "outputs/p/note.md",
        bytes: Buffer.from("private note"),
        role: "output",
        project_id: "p",
      },
      {
        path: "inputs/ctx/context.json",
        bytes: Buffer.from(JSON.stringify(project.context)),
        role: "input",
      },
    ],
  );
  const invocation: InvocationRecord = {
    schema_version: 1,
    invocation_id: "i",
    execution_scope: "preview",
    subject_id: "project:p",
    capability: "write",
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
  await journal.commit("invocations/i", invocation);
  await journal.commitMany(
    {
      "invocations/i": { ...invocation, status: "succeeded" },
      "responses/i": { markdown: "private model response" },
      "observations/i/m": { source_text: "private diagnostic" },
    },
    "invocation_finished",
  );
  return { root, store, manager, journal, id };
}
const mutex = async <T>(work: () => Promise<T>) => work();
it("lazy restore fetches only controls and active artifacts; committed inactive bytes load and hash check on demand", async () => {
  const f = await fixture();
  const fresh = new ImmutableWorkspaceManager({
    store: f.store,
    scope: "preview",
    local_root: join(f.root, "fresh"),
    verify_preflight: false,
    lazy_restore: true,
  });
  f.store.calls.length = 0;
  const h = await fresh.restore(f.id);
  await expect(
    readFile(join(h.root_dir, "projects/p/sources/original.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const expectedHash = sha256("private original source");
  expect(
    f.store.calls.some(
      (c) => c.operation === "read" && c.key.endsWith(expectedHash),
    ),
  ).toBe(false);
  expect(
    Buffer.from(
      await fresh.readFile(h, "projects/p/sources/original.txt"),
    ).toString(),
  ).toBe("private original source");
  expect(
    f.store.calls.some(
      (c) => c.operation === "read" && c.key.endsWith(expectedHash),
    ),
  ).toBe(true);
  await expect(
    fresh.readFile(h, "projects/other/secret.md"),
  ).rejects.toMatchObject({ code: "not_found" });
});
it("detach commit survives exit before GC; next fresh run retains audit and deletes only unreferenced aged blobs", async () => {
  const f = await fixture();
  const prefix = f.manager.prefix(f.id);
  await expect(
    maintainWorkspace({
      manager: f.manager,
      journal: f.journal,
      store: f.store,
      prefix,
      with_mutex: mutex,
      now: new Date("2026-10-13T12:00:00Z"),
      after_detach: async () => {
        throw new Error("process_exit_after_detach");
      },
    }),
  ).rejects.toThrow("process_exit_after_detach");
  const nextManager = new ImmutableWorkspaceManager({
    store: new FileObjectStore(f.store.root),
    scope: "preview",
    local_root: join(f.root, "next"),
    verify_preflight: false,
    lazy_restore: true,
  });
  const next = new WorkspaceJournal(
    nextManager,
    await nextManager.restore(f.id),
    "next",
  );
  expect(await next.load("projects/p")).toMatchObject({
    retention_pruned: true,
    state: "preview_ready",
    candidate: { candidate_id: "c" },
  });
  expect(await next.load("projects/p")).not.toHaveProperty("snapshots");
  expect(await next.load("responses/i")).toBeUndefined();
  expect(await next.load("contexts/ctx")).toBeUndefined();
  expect(await next.load("invocations/i")).toMatchObject({
    status: "succeeded",
    usage: { cost_status: "unknown" },
  });
  expect(await next.load("identity")).toEqual({
    cursor: "committed",
    candidate_id: "c",
  });
  const sourceKey = prefix + "blobs/" + sha256("private original source");
  expect(await f.store.stat(sourceKey)).toMatchObject({ size: 23 });
  const result = await maintainWorkspace({
    manager: nextManager,
    journal: next,
    store: nextManager.options.store,
    prefix,
    with_mutex: mutex,
    now: new Date("2026-12-13T12:00:00Z"),
  });
  expect(result.gc.deleted).toContain(sourceKey);
  await expect(f.store.read(sourceKey)).rejects.toMatchObject({
    code: "not_found",
  });
  expect((await listAll(f.store, prefix + "commits/")).length).toBeGreaterThan(
    4,
  );
  expect((await nextManager.restore(f.id)).records.identity).toEqual({
    cursor: "committed",
    candidate_id: "c",
  });
  expect(result.image_gc.status).toBe("not_exercised");
});
it("unknown request always protects full ended project", async () => {
  const f = await fixture();
  const old = await f.journal.load<InvocationRecord>("invocations/i");
  const freshCall = {
    ...old!,
    invocation_id: "pending",
    status: "prepared" as const,
    messages: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: null,
      cost_status: "unknown" as const,
    },
  };
  await f.journal.commit("invocations/pending", freshCall);
  const result = await maintainWorkspace({
    manager: f.manager,
    journal: f.journal,
    store: f.store,
    prefix: f.manager.prefix(f.id),
    with_mutex: mutex,
    now: new Date("2026-12-13T12:00:00Z"),
  });
  expect(result.blocked_projects).toContainEqual({
    project_id: "p",
    reason: "unresolved_invocation",
  });
  expect(await f.journal.load("projects/p")).toHaveProperty("snapshots");
  expect(result.detached_projects).toHaveLength(0);
});
it("actual delivery references must be complete and terminal before source detachment, irrespective of saved closed state", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-retention-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "production",
    local_root: join(root, "local"),
    verify_preflight: false,
    lazy_restore: true,
  });
  const journal = new WorkspaceJournal(
    manager,
    await manager.restore("obs-notes-hub/reading", { allow_initialize: true }),
    "run",
  );
  const project = {
    schema_version: 1,
    project_id: "p",
    execution_scope: "production",
    workspace_id: "obs-notes-hub/reading",
    state: "closed_unmerged",
    completed_at: "2026-08-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    generation_version: 1,
    delivery_id: "delivery",
    candidate: { candidate_id: "c", url: "https://example.org/article" },
    context: { context_id: "ctx" },
    snapshots: [{ text: "source retained until factual PR confirmation" }],
  };
  await journal.commit("projects/p", project);
  await journal.commitMany(
    {
      "sealed-delivery": { workspace_revision: journal.handle.revision },
      "delivery-delivery": {
        delivery_id: "delivery",
        status: "closed_unmerged",
      },
    },
    "remote_fact_fixture",
  );
  const opts = {
    manager,
    journal,
    store,
    prefix: manager.prefix(journal.handle.workspace_id),
    with_mutex: mutex,
    now: new Date("2026-10-13T12:00:00Z"),
  };
  const unknown = await maintainWorkspace(opts);
  expect(unknown.detached_projects).toEqual([]);
  expect(unknown.blocked_projects).toContainEqual({
    project_id: "p",
    reason: "delivery_references_unverified_or_open",
  });
  const reopened = await maintainWorkspace({
    ...opts,
    delivery_fact: async () => ({ status: "open" as const, complete: true }),
  });
  expect(reopened.detached_projects).toEqual([]);
  expect(await journal.load("projects/p")).toHaveProperty("snapshots");
  const confirmed = await maintainWorkspace({
    ...opts,
    delivery_fact: async () => ({
      status: "closed_unmerged" as const,
      complete: true,
      finished_at: "2026-08-01T00:00:00Z",
    }),
  });
  expect(confirmed.detached_projects).toEqual(["p"]);
  expect(await journal.load("projects/p")).not.toHaveProperty("snapshots");
});
it("unknown terminal time starts a persistent 30-day clock rather than guessing from project creation", async () => {
  const f = await fixture();
  const p = await f.journal.load<Record<string, unknown>>("projects/p");
  delete p!.completed_at;
  await f.journal.commit("projects/p", p);
  const opts = {
    manager: f.manager,
    journal: f.journal,
    store: f.store,
    prefix: f.manager.prefix(f.id),
    with_mutex: mutex,
  };
  const first = await maintainWorkspace({
    ...opts,
    now: new Date("2026-10-13T12:00:00Z"),
  });
  expect(first.detached_projects).toHaveLength(0);
  expect(first.retention_marked).toEqual(["p"]);
  expect(await f.journal.load("storage/retention/p")).toMatchObject({
    observed_at: "2026-10-13T12:00:00.000Z",
  });
  const early = await maintainWorkspace({
    ...opts,
    now: new Date("2026-11-01T12:00:00Z"),
  });
  expect(early.detached_projects).toHaveLength(0);
  const later = await maintainWorkspace({
    ...opts,
    now: new Date("2026-11-14T12:00:00Z"),
  });
  expect(later.detached_projects).toEqual(["p"]);
});

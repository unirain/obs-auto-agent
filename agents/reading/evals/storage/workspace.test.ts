import { mkdtemp, readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import {
  AgentError,
  canonicalJson,
  sha256,
  type InvocationRecord,
  type WorkspaceHandle,
  type CheckpointResult,
} from "../../src/contracts/index.js";
import {
  PersistentInvocationJournal,
  recoveredInvocations,
} from "../../src/workspace/invocations.js";
import { aggregateUsage, beijingDay } from "../../src/workspace/usage.js";
import { assertCapacity, capacityView } from "../../src/storage/capacity.js";
import { preflight, listAll } from "../../src/storage/preflight.js";
import {
  sealDelivery,
  sealPreviewIfReviewPassed,
} from "../../src/workspace/seal.js";
import { collectGarbage } from "../../src/workspace/gc.js";
import { encode } from "../../src/workspace/manifest.js";
const id = "obs-notes-hub/reading";
const step = (h: WorkspaceHandle, records = { value: { a: 1 } }) => ({
  expected_revision: h.revision,
  reason: "test",
  run_id: "run",
  records,
});
const ok = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
async function fixture(scope: "production" | "preview" = "production") {
  const root = await mkdtemp(join(tmpdir(), "storage-eval-"));
  const store = new FileObjectStore(join(root, "remote"), 1);
  const manager = new ImmutableWorkspaceManager({
    store,
    scope,
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  return { root, store, manager };
}
describe("immutable workspace persistent protocol", () => {
  it("initializes only explicitly and reconstructs records on a new instance", async () => {
    const { root, store, manager } = await fixture();
    await expect(manager.restore(id)).rejects.toMatchObject({
      code: "not_found",
    });
    let h = await manager.restore(id, { allow_initialize: true });
    h = ok(await manager.checkpoint(h, step(h)));
    const fresh = new ImmutableWorkspaceManager({
      store: new FileObjectStore(join(root, "remote"), 1),
      scope: "production",
      local_root: join(root, "fresh"),
      verify_preflight: false,
    });
    const restored = await fresh.restore(id);
    expect(restored.records.value).toEqual({ a: 1 });
    expect(restored.snapshot.sequence).toBe("00000000000000000001");
    expect(
      store.calls.filter(
        (c) => c.operation === "create" && c.key.includes("/commits/"),
      ),
    ).toHaveLength(2);
  });
  it("reconciles create-success-response-lost at the same sequence and persists effects", async () => {
    const { manager, store } = await fixture();
    let h = await manager.restore(id, { allow_initialize: true });
    store.faults.push({
      operation: "create",
      key: manager.prefix(id) + "commits/00000000000000000001.json",
      kind: "after",
    });
    h = ok(await manager.checkpoint(h, step(h)));
    expect((await manager.restore(id)).revision).toBe(h.revision);
    expect(h.snapshot.sequence).toBe("00000000000000000001");
  });
  it("loser cannot jump sequence or proceed after competing writer", async () => {
    const { root, manager, store } = await fixture();
    const h = await manager.restore(id, { allow_initialize: true });
    const other = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      local_root: join(root, "other"),
      verify_preflight: false,
    });
    const oh = await other.restore(id);
    ok(await manager.checkpoint(h, step(h)));
    const result = await other.checkpoint(oh, step(oh, { value: { a: 2 } }));
    expect(result.status).toBe("conflict");
    expect((await other.restore(id)).records.value).toEqual({ a: 1 });
    expect((await listAll(store, manager.prefix(id) + "commits/")).length).toBe(
      2,
    );
  });
  it("failure before commit preserves old full snapshot despite uploaded artifacts", async () => {
    const { manager, store } = await fixture();
    const h = await manager.restore(id, { allow_initialize: true });
    store.faults.push({
      operation: "create",
      key: manager.prefix(id) + "commits/00000000000000000001.json",
      kind: "permission",
    });
    await expect(manager.checkpoint(h, step(h))).rejects.toMatchObject({
      code: "permission",
    });
    const restored = await manager.restore(id);
    expect(restored.records.value).toBeUndefined();
    expect(restored.snapshot.sequence).toBe("00000000000000000000");
    expect(
      (await listAll(store, manager.prefix(id) + "blobs/")).length,
    ).toBeGreaterThan(0);
  });
  it("unknown readback blocks external effects; next run validates the committed snapshot", async () => {
    const { manager, store } = await fixture();
    const h = await manager.restore(id, { allow_initialize: true });
    const key = manager.prefix(id) + "commits/00000000000000000001.json";
    store.faults.push(
      { operation: "create", key, kind: "after" },
      { operation: "read", key, kind: "before" },
    );
    let calls = 0;
    const r = await manager.checkpoint(h, step(h));
    if (r.status === "committed") calls++;
    expect(r.status).toBe("unknown");
    expect(calls).toBe(0);
    expect((await manager.restore(id)).records.value).toEqual({ a: 1 });
  });
  it("does not initialize on list permissions, gaps or content corruption", async () => {
    const { manager, store } = await fixture();
    store.faults.push({ operation: "list", kind: "permission" });
    await expect(
      manager.restore(id, { allow_initialize: true }),
    ).rejects.toMatchObject({ code: "permission" });
    const h = await manager.restore(id, { allow_initialize: true });
    const commit = await store.read(h.snapshot.commit_key);
    await store.create(
      manager.prefix(id) + "commits/00000000000000000002.json",
      commit,
    );
    await expect(
      manager.restore(id, { allow_initialize: true }),
    ).rejects.toMatchObject({ code: "corrupt" });
  });
  it("rejects hostile persistence paths, symlinks and unauthorized scope", async () => {
    const { manager } = await fixture();
    const h = await manager.restore(id, { allow_initialize: true });
    await expect(
      manager.restore("obs-notes-hub/reading-preview/foo"),
    ).rejects.toMatchObject({ code: "scope" });
    for (const path of [
      ".claude/skills/bad",
      "state/../escape",
      "scratch/temp",
      ".env",
      "projects/p/draft/file.sh",
    ])
      await expect(
        manager.checkpoint(h, {
          ...step(h),
          files: [{ path, bytes: Buffer.from("evil"), role: "artifact" }],
        }),
      ).rejects.toMatchObject({ code: "corrupt" });
    await expect(
      manager.checkpoint({ ...h, execution_scope: "preview" }, step(h)),
    ).rejects.toMatchObject({ code: "scope" });
    await mkdir(join(h.root_dir, "projects"), { recursive: true });
    await symlink(tmpdir(), join(h.root_dir, "projects", "p"));
    await expect(
      manager.checkpoint(h, {
        ...step(h),
        files: [
          {
            path: "projects/p/draft/note.md",
            bytes: Buffer.from("x"),
            role: "artifact",
            project_id: "p",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
  });
  it("rejects malformed JSON schema and illegal preview state transitions", async () => {
    const { manager } = await fixture("preview");
    const pid = "obs-notes-hub/reading-preview/a";
    const h = await manager.restore(pid, { allow_initialize: true });
    await expect(
      manager.checkpoint(h, {
        ...step(h),
        event: {
          type: "stage_completed",
          from: "reviewing",
          to: "ready_for_delivery",
        },
      }),
    ).rejects.toMatchObject({ code: "scope" });
    await expect(
      manager.checkpoint(h, {
        ...step(h),
        event: { type: "stage_completed", from: "queued", to: "merged" },
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
    expect(sha256(canonicalJson({ b: 2, a: 1 }))).toBe(
      sha256(canonicalJson({ a: 1, b: 2 })),
    );
  });
  it("seals only committed reviewed scope files and detects mutation", async () => {
    const { manager } = await fixture("preview");
    let h = await manager.restore("obs-notes-hub/reading-preview/a", {
      allow_initialize: true,
    });
    h = ok(
      await manager.checkpoint(h, {
        ...step(h),
        files: [
          {
            path: "projects/p/draft/note.md",
            bytes: Buffer.from("![x](image.svg)"),
            role: "artifact",
            project_id: "p",
          },
        ],
      }),
    );
    const check = {
      review_passed: true,
      program_checks_passed: true,
      input_revision: h.revision,
      resources: [],
    };
    expect(
      (await sealPreviewIfReviewPassed(h, "p", check))?.publish_checks,
    ).toBe("not_exercised");
    await expect(sealDelivery(h, "p", check)).rejects.toMatchObject({
      code: "scope",
    });
    await writeFile(join(h.root_dir, "projects/p/draft/note.md"), "mutated");
    await expect(
      sealPreviewIfReviewPassed(h, "p", check),
    ).rejects.toMatchObject({ code: "corrupt" });
  });
});
describe("usage and call barrier", () => {
  it("persists prepared before call and recovery reports unknown; duplicates cannot pay again", async () => {
    const { manager } = await fixture();
    let h = await manager.restore(id, { allow_initialize: true });
    const journal = new PersistentInvocationJournal(manager);
    const record: InvocationRecord = {
      schema_version: 1,
      invocation_id: "call1",
      execution_scope: "production",
      subject_id: "p",
      capability: "selection",
      input_hash: sha256("input"),
      context_hash: sha256("context"),
      policy_hash: sha256("policy"),
      model: "model",
      sdk_version: "test",
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
    h = ok(await journal.prepare(h, record, "run"));
    const fresh = await manager.restore(id);
    expect(recoveredInvocations(fresh)[0]?.status).toBe("unknown");
    await expect(journal.prepare(fresh, record, "run")).rejects.toMatchObject({
      code: "conflict",
    });
    const message = {
      message_id: "m1",
      summary: true,
      usage: {
        input_tokens: 9,
        output_tokens: 2,
        cost_usd: 0.1,
        cost_status: "known" as const,
      },
    };
    h = ok(await journal.observe(h, "call1", message, "run"));
    const replay = ok(await journal.observe(h, "call1", message, "run"));
    expect(replay.revision).toBe(h.revision);
    h = ok(await journal.finish(h, "call1", "succeeded", "run"));
    expect(
      recoveredInvocations(await manager.restore(id))[0]?.usage.cost_usd,
    ).toBe(0.1);
  });
  it("uses latest SDK cumulative query summary instead of duplicate step totals", () => {
    expect(
      aggregateUsage([
        {
          message_id: "step",
          summary: false,
          usage: {
            input_tokens: 8,
            output_tokens: 1,
            cost_usd: null,
            cost_status: "unknown",
          },
        },
        {
          message_id: "s1",
          summary: true,
          usage: {
            input_tokens: 8,
            output_tokens: 1,
            cost_usd: 1,
            cost_status: "known",
          },
        },
        {
          message_id: "s2",
          summary: true,
          usage: {
            input_tokens: 16,
            output_tokens: 2,
            cost_usd: 2,
            cost_status: "known",
          },
        },
      ]).cost_usd,
    ).toBe(2);
    expect(aggregateUsage([]).cost_usd).toBeNull();
    expect(beijingDay("2026-10-13T16:01:00Z")).toBe("2026-10-14");
  });
});
describe("global shared capacity and GC", () => {
  it("does not double count pending upload already in inventory and preserves hard/control boundaries", () => {
    const objects = [
      {
        bucket: "b",
        key: "key",
        size: 49_000_000_000,
        created_at: "2026-10-13T00:00:00Z",
      },
    ];
    const view = capacityView(objects, [
      {
        reservation_id: "r",
        execution_scope: "preview",
        bucket: "b",
        key: "key",
        version: null,
        expected_bytes: 49_000_000_000,
        state: "pending",
      },
    ]);
    expect(view.reserved_bytes).toBe(0);
    expect(view.accepts_generation).toBe(false);
    expect(() => assertCapacity(view, 1, "generation")).toThrow();
    expect(() => assertCapacity(view, 1, "control")).not.toThrow();
    expect(() => assertCapacity(view, 1_000_000_001, "control")).toThrow();
  });
  it("protects HEAD blobs and permanent commits; confirmed lost delete response is idempotent", async () => {
    const { manager, store } = await fixture();
    let h = await manager.restore(id, { allow_initialize: true });
    h = ok(await manager.checkpoint(h, step(h)));
    const prefix = manager.prefix(id);
    const orphan = prefix + "blobs/" + sha256("orphan");
    await store.create(orphan, Buffer.from("orphan"));
    store.faults.push({ operation: "delete", key: orphan, kind: "after" });
    const result = await collectGarbage(store, prefix, h, {
      protected_revisions: new Set(),
      reference_knowledge_complete: true,
      now: "2027-10-13T00:00:00Z",
    });
    expect(result.deleted).toContain(orphan);
    expect(result.retained).toContain(h.snapshot.commit_key);
    expect((await manager.restore(id)).records.value).toEqual({ a: 1 });
    const second = await collectGarbage(store, prefix, h, {
      protected_revisions: new Set(),
      reference_knowledge_complete: true,
      now: "2027-10-13T00:00:00Z",
    });
    expect(second.deleted).toHaveLength(0);
  });
});
describe("private bucket preflight", () => {
  it.each(["enabled", "suspended"] as const)(
    "rejects %s versioning",
    async (versioning) => {
      const store = new FileObjectStore("unused", 1, {
        versioning,
        acl: "private",
        endpoint: "https://oss-cn-beijing.aliyuncs.com",
        lifecycle: [],
        anonymous_readable: false,
      });
      await expect(preflight(store)).rejects.toMatchObject({
        code: "configuration",
      });
    },
  );
});
describe("additional adversarial restore contracts", () => {
  it("empty listing cannot hide an existing zero commit", async () => {
    const { manager, store, root } = await fixture();
    await manager.restore(id, { allow_initialize: true });
    const listing = store.list.bind(store);
    store.list = async (prefix, cursor) =>
      prefix.endsWith("/commits/")
        ? { objects: [], next_cursor: null }
        : listing(prefix, cursor);
    const fresh = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      local_root: join(root, "fresh"),
      verify_preflight: false,
    });
    await expect(
      fresh.restore(id, { allow_initialize: true }),
    ).rejects.toMatchObject({ code: "corrupt" });
    expect(
      store.calls.filter(
        (c) => c.operation === "create" && c.key.includes("/commits/"),
      ),
    ).toHaveLength(1);
  });
  it("a later pagination failure cannot be treated as a complete chain", async () => {
    const { manager, store } = await fixture();
    let h = await manager.restore(id, { allow_initialize: true });
    h = ok(await manager.checkpoint(h, step(h)));
    const listing = store.list.bind(store);
    store.list = async (prefix, cursor) => {
      if (prefix.endsWith("/commits/") && cursor)
        throw new AgentError("transient", "Page unavailable");
      return listing(prefix, cursor);
    };
    await expect(
      manager.restore(id, { allow_initialize: true }),
    ).rejects.toMatchObject({ code: "transient" });
  });
  it("hash corruption of referenced blob stops restoration instead of dropping the file", async () => {
    const { manager, store } = await fixture();
    let h = await manager.restore(id, { allow_initialize: true });
    h = ok(await manager.checkpoint(h, step(h)));
    const blob =
      manager.prefix(id) + "blobs/" + h.snapshot.manifest.files[0]!.sha256;
    store.faults.push({ operation: "read", key: blob, kind: "corrupt" });
    await expect(
      manager.restore(id, { allow_initialize: true }),
    ).rejects.toMatchObject({ code: "corrupt" });
    expect((await manager.restore(id)).records.value).toEqual({ a: 1 });
  });
  it("historical restore proves the old committed artifact and forbids writing that handle", async () => {
    const { manager } = await fixture();
    let h = await manager.restore(id, { allow_initialize: true });
    h = ok(await manager.checkpoint(h, step(h)));
    const revision = h.revision;
    h = ok(await manager.checkpoint(h, step(h, { value: { a: 2 } })));
    const historical = await manager.restoreRevision(id, revision);
    expect(historical.records.value).toEqual({ a: 1 });
    expect(
      (await manager.checkpoint(historical, step(historical))).status,
    ).toBe("conflict");
    expect((await manager.restore(id)).records.value).toEqual({ a: 2 });
  });
  it("GC refuses to act with incomplete knowledge or missing protected revisions", async () => {
    const { manager, store } = await fixture();
    const h = await manager.restore(id, { allow_initialize: true });
    await expect(
      collectGarbage(store, manager.prefix(id), h, {
        protected_revisions: new Set(),
        reference_knowledge_complete: false,
        now: "2027-10-13T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "unknown" });
    await expect(
      collectGarbage(store, manager.prefix(id), h, {
        protected_revisions: new Set(["missing"]),
        reference_knowledge_complete: true,
        now: "2027-10-13T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
    expect(store.calls.filter((c) => c.operation === "delete")).toHaveLength(0);
  });
  it("scope-controlled integration identity cannot be selected by manifest data", async () => {
    const { store, root } = await fixture();
    const defaultManager = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      local_root: root,
    });
    await expect(
      defaultManager.restore("obs-notes-hub/reading-integration"),
    ).rejects.toMatchObject({ code: "scope" });
    const testManager = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      local_root: root,
      verify_preflight: false,
      trusted_workspace_id: "obs-notes-hub/reading-integration",
    });
    expect(
      (
        await testManager.restore("obs-notes-hub/reading-integration", {
          allow_initialize: true,
        })
      ).execution_scope,
    ).toBe("production");
    await expect(testManager.restore(id)).rejects.toMatchObject({
      code: "scope",
    });
  });
});
it("two real filesystem clients racing initialization recover the one complete zero commit", async () => {
  const { manager, store, root } = await fixture();
  const competitor = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root, 1),
    scope: "production",
    local_root: join(root, "competitor"),
    verify_preflight: false,
  });
  const handles = await Promise.all([
    manager.restore(id, { allow_initialize: true }),
    competitor.restore(id, { allow_initialize: true }),
  ]);
  expect(handles[0]!.revision).toBe(handles[1]!.revision);
  expect((await listAll(store, manager.prefix(id) + "commits/")).length).toBe(
    1,
  );
});

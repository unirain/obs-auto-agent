import { expect, it } from "vitest";
import {
  collectImageGarbage,
  type ImageGCStore,
  type ImageVersion,
  type RemoteImageReferences,
} from "../../src/publish/image-gc.js";
import { AgentError, sha256 } from "../../src/contracts/index.js";
import { MemoryJournal } from "./helpers.js";
const bytes = Buffer.from("owned immutable image");
const hash = sha256(bytes);
const key = `reading-agent/integration/p1/2026-01-01-article-diagram-${hash}.png`;
const receipt = {
  object_key: key,
  project_id: "p1",
  sha256: hash,
  bytes: bytes.length,
  mime: "image/png",
  url: `https://image.example/${key}`,
  version_id: "v1",
  confirmed_at: "2026-01-01T00:00:00Z",
};
class Images implements ImageGCStore {
  objects = new Map<string, { metadata: ImageVersion; content: Uint8Array }>();
  deletes = 0;
  failAfterDelete = false;
  failRead = false;
  complete = true;
  constructor() {
    this.objects.set("v1", {
      metadata: {
        key,
        version_id: "v1",
        bytes: bytes.length,
        created_at: "2026-01-01T00:00:00Z",
      },
      content: bytes,
    });
  }
  async inventory() {
    return {
      complete: this.complete,
      objects: [...this.objects.values()].map((v) => v.metadata),
    };
  }
  async getVersion(k: string, v: string | null) {
    if (this.failRead) throw new AgentError("unknown", "read unknown");
    const o = this.objects.get(v ?? "null");
    return o && o.metadata.key === k
      ? { content: o.content, mime: "image/png", version_id: v }
      : null;
  }
  async deleteVersion(_k: string, v: string | null) {
    this.deletes++;
    this.objects.delete(v ?? "null");
    if (this.failAfterDelete) {
      this.failRead = true;
      throw new AgentError("unknown", "delete response lost");
    }
  }
}
const references = (): RemoteImageReferences => ({
  complete: true,
  urls: new Set(),
  default_branch_commit: "a".repeat(40),
  open_pr_heads: [],
});
function setup() {
  const journal = new MemoryJournal();
  journal.data.set("projects/p1", {
    schema_version: 1,
    project_id: "p1",
    state: "closed_unmerged",
    retention_pruned: true,
    retention_pruned_at: "2026-01-01T00:00:00Z",
  });
  journal.data.set("resources/p1", [receipt]);
  journal.data.set("storage/reservations/r1", {
    schema_version: 1,
    state: "confirmed",
    key,
    project_id: "p1",
  });
  const store = new Images();
  let releases = 0;
  const options = {
    execution_scope: "production" as const,
    prefix: "reading-agent/integration/",
    journal,
    records: () => Object.fromEntries(journal.data),
    store,
    references: async () => references(),
    beforeDelete: async () => {},
    afterKeyAbsent: async () => {
      releases++;
      await journal.commit("storage/reservations/r1", {
        state: "released",
        key,
      });
    },
    now: () => new Date("2026-10-13T00:00:00Z"),
  };
  return { journal, store, options, releases: () => releases };
}
it("owned closed/pruned/unreferenced version is deleted only after intent; lost response reconciles next process and releases once", async () => {
  const { journal, store, options, releases } = setup();
  store.failAfterDelete = true;
  const failed = await collectImageGarbage(options);
  expect(failed.complete).toBe(false);
  expect(failed.unknown).toEqual([key]);
  expect(releases()).toBe(0);
  expect(store.deletes).toBe(1);
  expect(
    [...journal.data.values()].find(
      (v) => (v as { state?: string }).state === "deleting",
    ),
  ).toMatchObject({ key, version_id: "v1" });
  store.failRead = false;
  store.failAfterDelete = false;
  const next = await collectImageGarbage({ ...options, store });
  expect(next.deleted).toEqual([key]);
  expect(releases()).toBe(1);
  expect(store.deletes).toBe(1);
  expect(await journal.load("storage/reservations/r1")).toMatchObject({
    state: "released",
  });
});
it.each([
  "active",
  "pending_upload",
  "unknown_call",
  "merged",
  "open_delivery",
  "not_pruned",
  "recent_prune",
  "remote_reference",
  "alternate_domain_reference",
  "incomplete_remote",
  "incomplete_inventory",
] as const)(
  "protects %s images and never releases capacity",
  async (reason) => {
    const { journal, store, options, releases } = setup();
    let refs = references();
    if (reason === "active")
      journal.data.set("projects/p1", { schema_version: 1, state: "deferred" });
    if (reason === "pending_upload")
      journal.data.set("resource-intent", {
        schema_version: 1,
        status: "unknown",
        object_key: key,
      });
    if (reason === "unknown_call")
      journal.data.set("invocations/q1", {
        schema_version: 1,
        subject_id: "project:p1",
        status: "unknown",
      });
    if (reason === "merged")
      journal.data.set("projects/p1", {
        schema_version: 1,
        state: "merged",
        retention_pruned: true,
        retention_pruned_at: "2026-01-01T00:00:00Z",
      });
    if (reason === "open_delivery") {
      journal.data.set("delivery-d1", {
        schema_version: 1,
        delivery_id: "d1",
        status: "awaiting_review",
        updated_at: "2026-10-13T00:00:00Z",
      });
      journal.data.set("sealed-d1", {
        schema_version: 1,
        resources: [receipt],
      });
    }
    if (reason === "not_pruned")
      journal.data.set("projects/p1", {
        schema_version: 1,
        state: "closed_unmerged",
        retention_pruned: false,
      });
    if (reason === "recent_prune")
      journal.data.set("projects/p1", {
        schema_version: 1,
        state: "closed_unmerged",
        retention_pruned: true,
        retention_pruned_at: "2026-10-12T00:00:00Z",
      });
    if (reason === "remote_reference") refs.urls.add(receipt.url);
    if (reason === "alternate_domain_reference")
      refs.urls.add(`https://alternate.example/${key}?resize=50`);
    if (reason === "incomplete_remote") refs.complete = false;
    if (reason === "incomplete_inventory") store.complete = false;
    const result = await collectImageGarbage({
      ...options,
      references: async () => refs,
    });
    expect(result.deleted).toEqual([]);
    expect(store.deletes).toBe(0);
    expect(releases()).toBe(0);
  },
);
it("unknown version hash and untracked objects are retained; fresh references appearing after intent stop deletion", async () => {
  let s = setup();
  s.store.objects.get("v1")!.content = Buffer.from("changed by another writer");
  expect((await collectImageGarbage(s.options)).unknown).toEqual([key]);
  expect(s.store.deletes).toBe(0);
  s = setup();
  s.journal.data.delete("resources/p1");
  expect((await collectImageGarbage(s.options)).retained).toEqual([key]);
  expect(s.store.deletes).toBe(0);
  s = setup();
  let reads = 0;
  const result = await collectImageGarbage({
    ...s.options,
    references: async () => {
      const r = references();
      if (++reads > 1) r.urls.add(receipt.url);
      return r;
    },
  });
  expect(result.retained).toEqual([key]);
  expect(s.store.deletes).toBe(0);
});
it("preview cannot instantiate cleanup capability; checkpoint failure prevents delete; every version is protected and reconciled separately", async () => {
  const { store, options, journal } = setup();
  await expect(
    collectImageGarbage({ ...options, execution_scope: "preview" }),
  ).rejects.toThrow("Preview");
  expect(store.deletes).toBe(0);
  journal.commit = async () => {
    throw new Error("checkpoint failed");
  };
  await expect(collectImageGarbage(options)).rejects.toThrow("checkpoint");
  expect(store.deletes).toBe(0);
  const next = setup();
  next.store.objects.set("v2", {
    metadata: {
      key,
      version_id: "v2",
      bytes: bytes.length,
      created_at: "2026-01-02T00:00:00Z",
    },
    content: bytes,
  });
  expect((await collectImageGarbage(next.options)).deleted).toEqual([key]);
  expect(next.store.deletes).toBe(2);
  expect(next.releases()).toBe(1);
});

it.each([
  "project_schema",
  "project_future_state",
  "invocation_schema",
  "invocation_future_state",
  "reservation_schema",
  "reservation_future_state",
  "upload_schema",
  "upload_future_state",
  "delivery_schema",
  "delivery_future_state",
  "gc_schema",
  "gc_future_state",
] as const)(
  "rejects %s before image inventory/read/delete rather than ignoring unknown control facts",
  async (kind) => {
    const s = setup();
    let inventories = 0;
    const inventory = s.store.inventory.bind(s.store);
    s.store.inventory = async () => {
      inventories++;
      return inventory();
    };
    if (kind === "project_schema")
      s.journal.data.set("projects/p1", {
        schema_version: 2,
        state: "closed_unmerged",
        retention_pruned: true,
        retention_pruned_at: "2026-01-01T00:00:00Z",
      });
    if (kind === "project_future_state")
      s.journal.data.set("projects/p1", {
        schema_version: 1,
        state: "future_done",
      });
    if (kind === "invocation_schema")
      s.journal.data.set("invocations/x", {
        status: "unknown",
        subject_id: "project:p1",
      });
    if (kind === "invocation_future_state")
      s.journal.data.set("invocations/x", {
        schema_version: 1,
        status: "future_unknown",
        subject_id: "project:p1",
      });
    if (kind === "reservation_schema")
      s.journal.data.set("storage/reservations/r1", {
        state: "confirmed",
        key,
      });
    if (kind === "reservation_future_state")
      s.journal.data.set("storage/reservations/r1", {
        schema_version: 1,
        state: "future_release",
        key,
      });
    if (kind === "upload_schema")
      s.journal.data.set("resource-x", {
        status: "confirmed",
        object_key: key,
        receipt,
      });
    if (kind === "upload_future_state")
      s.journal.data.set("resource-x", {
        schema_version: 1,
        status: "future_confirmed",
        object_key: key,
        receipt,
      });
    if (kind === "delivery_schema" || kind === "delivery_future_state") {
      s.journal.data.set("delivery-d1", {
        ...(kind === "delivery_schema" ? {} : { schema_version: 1 }),
        status:
          kind === "delivery_schema" ? "closed_unmerged" : "future_closed",
        delivery_id: "d1",
      });
      s.journal.data.set("sealed-d1", {
        schema_version: 1,
        resources: [receipt],
      });
    }
    if (kind === "gc_schema")
      s.journal.data.set("image-gc-x", { state: "deleting", key });
    if (kind === "gc_future_state")
      s.journal.data.set("image-gc-x", {
        schema_version: 1,
        state: "future_deleted",
        key,
      });
    await expect(collectImageGarbage(s.options)).rejects.toThrow("Unsupported");
    expect(s.store.deletes).toBe(0);
    expect(s.releases()).toBe(0);
    expect(inventories).toBe(0);
  },
);

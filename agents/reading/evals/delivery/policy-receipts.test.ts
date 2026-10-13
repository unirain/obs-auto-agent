import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { WorkspaceJournal } from "../../src/app/journal.js";
import { Publisher } from "../../src/publish/publisher.js";
import { ResourcePublisher } from "../../src/publish/resources.js";
import type {
  PolicyEvidence,
  DeliveryRecord,
} from "../../src/publish/types.js";
import { FakeGitHub, sealed, MemoryJournal } from "./helpers.js";
const evidence = (step: number): PolicyEvidence => ({
  check_id: String(step).padStart(64, "a"),
  policy_commit: "b".repeat(40),
  policy_hash: "c".repeat(64),
  checked_at: "2026-10-13T01:00:00Z",
  execution_permission: "allowed",
});
it("each remote publication write is linked to committed latest-policy evidence surviving a new restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-policy-"));
  const store = new FileObjectStore(join(root, "objects"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "production",
    trusted_workspace_id: "obs-notes-hub/reading-integration",
    prefix: "workspaces",
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  try {
    const handle = await manager.restore("obs-notes-hub/reading-integration", {
      allow_initialize: true,
    });
    const journal = new WorkspaceJournal(manager, handle, "policy-test");
    const git = new FakeGitHub();
    git.failure = "branch";
    let count = 0;
    const permission = async () => evidence(++count);
    const options = {
      workspace_id: handle.workspace_id,
      committedRevision: async () => journal.handle.revision,
      verifyCommittedDelivery: async () => {},
      classificationCurrent: async () => true,
      identity: { name: "Bot", email: "bot@example.com" },
      now: () => new Date("2026-10-13T01:00:00Z"),
    };
    await expect(
      new Publisher(git, journal, permission, options).publish(sealed()),
    ).rejects.toThrow("lost");
    const restored = new WorkspaceJournal(
      manager,
      await manager.restore(handle.workspace_id),
      "next",
    );
    const before = await restored.load<DeliveryRecord>("delivery-d1");
    expect(before?.policy_checks?.map((p) => p.action)).toEqual([
      "git_object",
      "create_branch",
    ]);
    expect(
      before?.policy_checks?.every(
        (p) =>
          p.status === "verified" &&
          p.evidence?.policy_commit === "b".repeat(40),
      ),
    ).toBe(true);
    git.failure = null;
    await new Publisher(git, restored, permission, {
      ...options,
      committedRevision: async () => restored.handle.revision,
    }).publish(sealed());
    const final = await restored.load<DeliveryRecord>("delivery-d1");
    expect(final?.policy_checks?.map((p) => p.action)).toEqual([
      "git_object",
      "create_branch",
      "create_pr",
    ]);
    expect(git.calls.filter((c) => c === "pr")).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("image upload policy receipt commits before the effect, malformed evidence fails before effect and void legacy receipt stays unverified", async () => {
  const input = {
    project_id: "p1",
    first_generated_date: "2026-10-13",
    article_slug: "article",
    description: "diagram",
    extension: "png" as const,
    mime: "image/png",
    content: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  };
  const journal = new MemoryJournal();
  let stored: Uint8Array | null = null,
    writes = 0;
  const image = {
    get: async () =>
      stored ? { content: stored, mime: "image/png", version_id: null } : null,
    create: async (_k: string, bytes: Uint8Array) => {
      const intent = [...journal.data.values()].find(
        (v) => (v as { status?: string }).status === "unknown",
      ) as { policy_checks?: { status: string }[] };
      expect(intent.policy_checks?.at(-1)?.status).toBe("verified");
      writes++;
      stored = bytes;
    },
    url: () => "https://image.example/resource.png",
    accessible: async () => true,
  };
  const capacity = { reserve: async () => {}, confirm: async () => {} };
  await new ResourcePublisher(image, journal, capacity, async () =>
    evidence(1),
  ).upload(input);
  expect(writes).toBe(1);
  const other = new MemoryJournal();
  stored = null;
  await expect(
    new ResourcePublisher(image, other, capacity, async () => ({
      ...evidence(1),
      policy_commit: null,
    })).upload(input),
  ).rejects.toThrow("Invalid current policy evidence");
  expect(writes).toBe(1);
  const git = new FakeGitHub(),
    legacy = new MemoryJournal();
  await new Publisher(git, legacy, async () => {}, {
    workspace_id: sealed().workspace_id,
    committedRevision: async () => sealed().workspace_revision,
    verifyCommittedDelivery: async () => {},
    classificationCurrent: async () => true,
    identity: { name: "Bot", email: "bot@example.com" },
    now: () => new Date("2026-10-13T01:00:00Z"),
  }).publish(sealed());
  expect(
    (await legacy.load<DeliveryRecord>("delivery-d1"))?.policy_checks?.every(
      (c) => c.status === "legacy_unverified",
    ),
  ).toBe(true);
});

it("unknown or unversioned operation records fail closed before reads become writes; no silent migration or reinitialization", async () => {
  const git = new FakeGitHub(),
    journal = new MemoryJournal();
  await journal.commit("delivery-project-p1", ["d1"]);
  await journal.commit("delivery-d1", {
    delivery_id: "d1",
    project_id: "p1",
    schema_version: 2,
  });
  const p = new Publisher(git, journal, async () => {}, {
    workspace_id: sealed().workspace_id,
    committedRevision: async () => sealed().workspace_revision,
    verifyCommittedDelivery: async () => {},
    classificationCurrent: async () => true,
    identity: { name: "Bot", email: "bot@example.com" },
  });
  await expect(p.publish(sealed())).rejects.toThrow(
    "Unsupported delivery record schema",
  );
  expect(git.calls).toEqual([]);
  const input = {
    project_id: "p1",
    first_generated_date: "2026-10-13",
    article_slug: "article",
    description: "diagram",
    extension: "png" as const,
    mime: "image/png",
    content: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
  };
  const resource = new MemoryJournal();
  const { sha256 } = await import("../../src/publish/validate.js");
  const key = `reading-agent/p1/2026-10-13-article-diagram-${sha256(input.content)}.png`;
  await resource.commit("resource-" + sha256(key), {
    status: "reserved",
    object_key: key,
    sha256: sha256(input.content),
    bytes: input.content.length,
    mime: input.mime,
  });
  let writes = 0;
  const image = {
    get: async () => null,
    create: async () => {
      writes++;
    },
    url: () => "",
    accessible: async () => true,
  };
  await expect(
    new ResourcePublisher(
      image,
      resource,
      { reserve: async () => {}, confirm: async () => {} },
      async () => {},
    ).upload(input),
  ).rejects.toThrow("Unsupported resource intent schema");
  expect(writes).toBe(0);
});

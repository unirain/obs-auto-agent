import { describe, expect, it } from "vitest";
import { Publisher } from "../../src/publish/publisher.js";
import {
  validateDelivery,
  deliveryValidationHash,
} from "../../src/publish/validate.js";
import { FakeGitHub, MemoryJournal, sealed } from "./helpers.js";
const now = () => new Date("2026-10-13T01:00:00Z");
const publisher = (
  git: FakeGitHub,
  journal: MemoryJournal,
  permission = async () => {},
  date = now,
) =>
  new Publisher(git, journal, permission, {
    workspace_id: "obs-notes-hub/reading-integration",
    committedRevision: async () => "a".repeat(64),
    verifyCommittedDelivery: async () => {},
    classificationCurrent: async () => true,
    identity: { name: "Bot", email: "bot@example.com" },
    now: date,
  });
describe("durable Publisher", () => {
  it.each(["objects", "branch", "pr"] as const)(
    "reconciles lost %s response in the next process",
    async (boundary) => {
      const journal = new MemoryJournal();
      const git = new FakeGitHub();
      git.failure = boundary;
      await expect(publisher(git, journal).publish(sealed())).rejects.toThrow();
      const before = git.calls.filter((c) => c === boundary).length;
      expect(await journal.load("delivery-d1")).toMatchObject({
        status: "publishing",
        uncertain_action: expect.any(String),
        prepared: { commit_sha: "e".repeat(40) },
      });
      git.failure = null;
      expect((await publisher(git, journal).publish(sealed())).status).toBe(
        "awaiting_review",
      );
      expect(git.calls.filter((c) => c === boundary)).toHaveLength(before);
      expect(git.calls.filter((c) => c === "pr")).toHaveLength(1);
    },
  );
  it("does not write a branch until commit intent is committed", async () => {
    const journal = new MemoryJournal();
    const git = new FakeGitHub();
    journal.fail = "delivery-d1";
    await expect(publisher(git, journal).publish(sealed())).rejects.toThrow(
      "checkpoint",
    );
    expect(git.calls).toEqual([]);
  });
  it("never rewrites pending, closed or merged PRs and indexes the default branch fact", async () => {
    const journal = new MemoryJournal();
    const git = new FakeGitHub();
    const p = publisher(git, journal);
    await p.publish(sealed());
    const writes = git.calls.length;
    for (const state of ["open", "closed_unmerged", "merged"] as const) {
      git.pr!.state = state;
      const result = await publisher(
        git,
        journal,
        async () => {
          throw new Error("paused");
        },
        () => new Date("2026-10-20T00:00:00Z"),
      ).publish(sealed());
      expect(result.status).toBe(state === "open" ? "awaiting_review" : state);
      expect(git.calls).toHaveLength(writes);
    }
  });
  it("protects human branch changes and default branch filenames/sources", async () => {
    const journal = new MemoryJournal();
    const git = new FakeGitHub();
    git.failure = "branch";
    await expect(publisher(git, journal).publish(sealed())).rejects.toThrow();
    git.failure = null;
    git.branch = "f".repeat(40);
    expect((await publisher(git, journal).publish(sealed())).status).toBe(
      "delivery_conflict",
    );
    expect(git.calls).not.toContain("pr");
    const other = new FakeGitHub();
    other.duplicate = true;
    expect(
      (await publisher(other, new MemoryJournal()).publish(sealed())).status,
    ).toBe("delivery_conflict");
    expect(other.calls).toEqual([]);
  });
  it("read unavailability never means absent; stale sources require resume after reconciliation", async () => {
    const journal = new MemoryJournal();
    const git = new FakeGitHub();
    git.failure = "pr";
    await expect(publisher(git, journal).publish(sealed())).rejects.toThrow();
    git.failure = "read";
    await expect(
      publisher(
        git,
        journal,
        async () => {},
        () => new Date("2026-10-20"),
      ).publish(sealed(), "publish-only"),
    ).rejects.toThrow("read unavailable");
    expect(await journal.load("delivery-d1")).toMatchObject({
      status: "publishing",
      uncertain_action: "create_pr",
    });
    const absent = new FakeGitHub();
    expect(
      (
        await publisher(
          absent,
          new MemoryJournal(),
          async () => {},
          () => new Date("2026-10-20"),
        ).publish(sealed(), "publish-only")
      ).status,
    ).toBe("needs_resume");
    expect(absent.calls).toEqual([]);
  });
  it("stops at every write boundary after current policy is revoked", async () => {
    const journal = new MemoryJournal();
    const git = new FakeGitHub();
    let allowed = true;
    const original = git.materialize.bind(git);
    git.materialize = async (p, b) => {
      await original(p, b);
      allowed = false;
    };
    await expect(
      publisher(git, journal, async () => {
        if (!allowed) throw new Error("revoked");
      }).publish(sealed()),
    ).rejects.toThrow("revoked");
    expect(git.calls).toEqual(["objects"]);
    expect(await journal.load("delivery-d1")).toMatchObject({
      uncertain_action: "git_object",
    });
    expect(
      (
        await publisher(git, journal, async () => {
          throw new Error("revoked");
        }).publish(sealed())
      ).status,
    ).toBe("policy_blocked");
    expect(git.calls).toEqual(["objects"]);
  });
  it("rejects preview, modified hashes, illegal paths, symlinks and stale validation", () => {
    for (const bad of [
      { execution_scope: "preview" },
      { files: [{ ...sealed().files[0]!, path: ".github/workflows/pwn.yml" }] },
      { files: [{ ...sealed().files[0]!, symlink: true }] },
      { validated_hash: "bad" },
    ]) {
      const d = { ...sealed(), ...bad } as ReturnType<typeof sealed>;
      expect(() =>
        validateDelivery(d, {
          id: d.workspace_id,
          revision: d.workspace_revision,
        }),
      ).toThrow();
    }
    const d = sealed();
    d.files[0]!.content = Buffer.from("modified");
    d.validated_hash = deliveryValidationHash(d);
    expect(() =>
      validateDelivery(d, {
        id: d.workspace_id,
        revision: d.workspace_revision,
      }),
    ).toThrow("hash/size");
  });
});

it("validation hash survives canonical control JSON key reordering after a real checkpoint representation", async () => {
  const { canonicalJson } = await import("../../src/contracts/index.js");
  const d = sealed();
  d.resources = [
    {
      object_key: "reading-agent/p1/" + "a".repeat(64) + ".png",
      sha256: "a".repeat(64),
      bytes: 1,
      mime: "image/png",
      url: "https://image.example/test.png",
      project_id: "p1",
      version_id: null,
      confirmed_at: "2026-10-13T00:00:00Z",
    },
  ];
  d.validated_hash = deliveryValidationHash(d);
  const canonical = JSON.parse(
    canonicalJson({
      ...d,
      files: d.files.map(({ content, ...f }) => ({
        ...f,
        content_base64: Buffer.from(content).toString("base64"),
      })),
    }),
  ) as Omit<typeof d, "files"> & {
    files: (Omit<(typeof d.files)[number], "content"> & {
      content_base64: string;
    })[];
  };
  const restored = {
    ...canonical,
    files: canonical.files.map(({ content_base64, ...f }) => ({
      ...f,
      content: Buffer.from(content_base64, "base64"),
    })),
  };
  expect(() =>
    validateDelivery(restored, {
      id: d.workspace_id,
      revision: d.workspace_revision,
    }),
  ).not.toThrow();
  expect(deliveryValidationHash(restored)).toBe(d.validated_hash);
});

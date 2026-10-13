import { expect, it } from "vitest";
import { Publisher } from "../../src/publish/publisher.js";
import {
  recoveryRoute,
  assertRefreshAllowed,
} from "../../src/publish/recovery.js";
import { FakeGitHub, MemoryJournal, sealed } from "./helpers.js";
const factory = (git: FakeGitHub, journal: MemoryJournal, now: () => Date) =>
  new Publisher(git, journal, async () => {}, {
    workspace_id: sealed().workspace_id,
    committedRevision: async () => sealed().workspace_revision,
    verifyCommittedDelivery: async () => {},
    classificationCurrent: async () => true,
    identity: { name: "Bot", email: "bot@example.com" },
    now,
  });
it("unchanged expired sources refresh immutable delivery atomically and reuse existing expected commit/branch", async () => {
  const git = new FakeGitHub(),
    journal = new MemoryJournal();
  git.failure = "branch";
  await expect(
    factory(git, journal, () => new Date("2026-10-13T01:00:00Z")).publish(
      sealed(),
    ),
  ).rejects.toThrow();
  git.failure = null;
  const later = () => new Date("2026-10-15T00:00:00Z");
  const p = factory(git, journal, later);
  expect((await p.publish(sealed(), "publish-only")).status).toBe(
    "needs_resume",
  );
  const next = await p.refreshVerified(sealed(), {
    delivery_id: "d2",
    workspace_revision: sealed().workspace_revision,
    sources_verified_at: "2026-10-15T00:00:00Z",
  });
  expect(await journal.load("delivery-d1")).toMatchObject({
    status: "superseded",
    superseded_by: "d2",
  });
  expect(next.generation_version).toBe(1);
  const resumed = await factory(git, journal, later).publish(sealed());
  expect(resumed.delivery_id).toBe("d2");
  expect(resumed.status).toBe("awaiting_review");
  expect(git.calls).toEqual(["objects", "branch", "pr"]);
  expect(await journal.load("delivery-d1")).toMatchObject({
    status: "superseded",
  });
});
it("refresh cannot proceed with existing PR, unknown remote write, or non-atomic journal", async () => {
  const git = new FakeGitHub(),
    journal = new MemoryJournal(),
    p = factory(git, journal, () => new Date("2026-10-13T01:00:00Z"));
  await p.publish(sealed());
  await expect(
    p.refreshVerified(sealed(), {
      delivery_id: "d2",
      workspace_revision: "r2",
      sources_verified_at: "2026-10-13T02:00:00Z",
    }),
  ).rejects.toThrow("full historical");
  const records = await p.history("p1");
  expect(() =>
    assertRefreshAllowed([
      {
        ...records[0]!,
        pr: null,
        status: "publishing",
        uncertain_action: "create_pr",
      },
    ]),
  ).toThrow();
  expect(
    recoveryRoute(sealed(), [], false, new Date("2026-10-13"), "publish-only"),
  ).toMatchObject({ route: "resume_classification", model_allowed: false });
});
it("trusted source freshness duration persists resume routing and the next run reuses that duration", async () => {
  const git = new FakeGitHub(), journal = new MemoryJournal();
  const create = (freshness: number) => new Publisher(git, journal, async () => {}, {
    workspace_id: sealed().workspace_id,
    committedRevision: async () => sealed().workspace_revision,
    verifyCommittedDelivery: async () => {},
    classificationCurrent: async () => true,
    identity: { name: "Bot", email: "bot@example.com" },
    now: () => new Date("2026-10-13T01:00:00Z"),
    sources_freshness_hours: freshness,
  });
  expect((await create(0.5).publish(sealed(), "publish-only")).status).toBe("needs_resume");
  expect(await journal.load("delivery-d1")).toMatchObject({ status: "needs_resume", reason: "sources_expired" });
  expect((await create(0.5).publish(sealed(), "publish-only")).status).toBe("needs_resume");
  expect(git.calls).toEqual([]);
  expect((await create(2).publish(sealed(), "publish-only")).status).toBe("awaiting_review");
  expect(git.calls).toEqual(["objects", "branch", "pr"]);
  expect(() => create(NaN)).toThrow("sources_freshness_hours");
});

import { expect, it } from "vitest";
import { prepareHumanReviewFeedback } from "../../src/publish/feedback.js";
import { sealed, MemoryJournal } from "./helpers.js";
import type {
  DeliveryRecord,
  PullRequestFact,
} from "../../src/publish/types.js";
const pr = (): PullRequestFact => ({
  number: 8,
  url: "https://github.com/test/repo/pull/8",
  state: "open",
  branch: "notes/p1/g1",
  head_sha: "a".repeat(40),
  delivery_id: "d1",
});
const record = (): DeliveryRecord => ({
  schema_version: 1,
  delivery_id: "d1",
  project_id: "p1",
  generation_version: 1,
  branch: "notes/p1/g1",
  status: "awaiting_review",
  prepared: null,
  pr: pr(),
  uncertain_action: null,
  reason: null,
  updated_at: "2026-10-13T00:00:00Z",
});
const feedback = () => ({
  schema_version: 1 as const,
  delivery_id: "d1",
  actor: "unirain",
  recorded_at: "2026-10-13T01:00:00Z",
  reason: "more_like_this" as const,
  review_minutes: 15,
  origin: "trusted_management" as const,
});
const input = () => ({
  feedback: feedback(),
  trusted_actor: "unirain",
  repository: "test/repo",
  workspace_id: sealed().workspace_id,
  request_id: "review_request_1",
  seal: sealed(),
  record: record(),
  github: {
    authority: async () => ({
      schema_version: 1 as const,
      complete: true,
      repository: "test/repo",
      default_branch: "main",
      default_commit_sha: "b".repeat(40),
      checked_at: "2026-10-13T01:00:00Z",
    }),
    inspectPullRequest: async () => pr(),
  },
  now: () => new Date("2026-10-13T01:00:00Z"),
});
it("read-only preparation returns one atomic record bundle with explicit trusted actor and fresh actual PR binding", async () => {
  const journal = new MemoryJournal();
  const bundle = await prepareHumanReviewFeedback(input());
  expect(journal.data.size).toBe(0);
  expect(bundle.feedback.pr_binding).toMatchObject({
    repository: "test/repo",
    number: 8,
    head_sha: "a".repeat(40),
  });
  expect(bundle.audit.actor).toBe("unirain");
  const records = {
    ...bundle.records,
    "management/requests/review_request_1": {
      status: "succeeded",
      feedback_audit_hash: bundle.audit.audit_hash,
    },
  };
  journal.fail = "management/requests/review_request_1";
  await expect(journal.commitMany(records)).rejects.toThrow("unknown");
  expect(await journal.load("review-feedback/d1")).toBeUndefined();
  expect(await journal.load("feedback-audit/review_request_1")).toBeUndefined();
  journal.fail = null;
  await journal.commitMany(records);
  expect(await journal.load("review-feedback/d1")).toMatchObject({
    actor: "unirain",
    review_minutes: 15,
  });
  expect(
    await journal.load("management/requests/review_request_1"),
  ).toMatchObject({ status: "succeeded" });
});
it.each([
  "actor",
  "bot",
  "delivery",
  "repository",
  "number",
  "url",
  "marker",
  "unavailable",
  "request_path",
] as const)(
  "rejects %s feedback before creating any mutation bundle",
  async (kind) => {
    const i = input();
    if (kind === "actor") i.feedback.actor = "different";
    if (kind === "bot") i.trusted_actor = i.feedback.actor = "bot[bot]";
    if (kind === "delivery") i.record.delivery_id = "other";
    if (kind === "repository") i.repository = "test/other";
    if (kind === "number")
      i.github.inspectPullRequest = async () => ({ ...pr(), number: 999 });
    if (kind === "url")
      i.github.inspectPullRequest = async () => ({
        ...pr(),
        url: "https://attacker.example/test/repo/pull/8",
      });
    if (kind === "marker")
      i.github.inspectPullRequest = async () => ({
        ...pr(),
        delivery_id: "other",
      });
    if (kind === "unavailable")
      i.github.inspectPullRequest = async () => {
        throw new Error("403");
      };
    if (kind === "request_path") i.request_id = "../unsafe";
    await expect(prepareHumanReviewFeedback(i)).rejects.toThrow();
  },
);
it("human branch changes are bound to the actual new head, with stale automatic outcome removed and no preference updates", async () => {
  const i = input();
  i.record.review_outcome = "accepted_without_changes";
  i.github.inspectPullRequest = async () => ({
    ...pr(),
    state: "merged",
    head_sha: "c".repeat(40),
    delivery_id: null,
    branch: "human/renamed",
  });
  const bundle = await prepareHumanReviewFeedback(i);
  expect(bundle.delivery.status).toBe("merged");
  expect(bundle.delivery.review_outcome).toBeUndefined();
  expect(bundle.feedback.pr_binding?.head_sha).toBe("c".repeat(40));
  expect(
    Object.keys(bundle.records).some((key) => key.includes("preferences")),
  ).toBe(false);
});

it('feedback cannot clear an existing delivery conflict or unresolved operation merely by observing one PR',async()=>{const i=input();i.record.status='delivery_conflict';i.record.reason='multiple_historical_prs';i.record.uncertain_action='reconcile';const bundle=await prepareHumanReviewFeedback(i);expect(bundle.delivery.status).toBe('delivery_conflict');expect(bundle.delivery.uncertain_action).toBe('reconcile');expect(bundle.delivery.reason).toBe('multiple_historical_prs');});

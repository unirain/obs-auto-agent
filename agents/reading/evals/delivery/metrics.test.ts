import { expect, it } from "vitest";
import {
  deliveryMetrics,
  recordHumanReviewFeedback,
} from "../../src/publish/metrics.js";
import { MemoryJournal } from "./helpers.js";
import type { DeliveryRecord } from "../../src/publish/types.js";
const record = (
  id: string,
  state: "open" | "merged" | "closed_unmerged",
  project = id,
): DeliveryRecord => ({
  schema_version: 1,
  delivery_id: id,
  project_id: project,
  generation_version: 1,
  branch: `notes/${project}/g1`,
  status: state === "open" ? "awaiting_review" : state,
  prepared: null,
  uncertain_action: null,
  reason: null,
  updated_at: "2026-10-13T00:00:00Z",
  pr: {
    number: 1,
    url: `https://github.com/test/repo/pull/${id}`,
    state,
    branch: `notes/${project}/g1`,
    head_sha: "a".repeat(40),
    delivery_id: id,
    created_at: "2026-01-01T00:00:00Z",
  },
});
it("counts actual unique PR outcomes and preserves unknown edits/cost/human effort", () => {
  const direct = {
    ...record("1", "merged"),
    review_outcome: "accepted_without_changes" as const,
  };
  const changed = {
    ...record("2", "merged"),
    review_outcome: "accepted_with_changes" as const,
  };
  const unknown = record("3", "merged");
  const pending = record("4", "open");
  const rejected = record("5", "closed_unmerged");
  const extra = record("6", "open", "4");
  delete extra.pr!.created_at;
  const metrics = deliveryMetrics(
    [
      direct,
      { ...direct, delivery_id: "refresh" },
      changed,
      unknown,
      pending,
      rejected,
      extra,
    ],
    [],
    { "1": { cost_status: "known", cost_usd: 0.3 } },
    new Date("2026-10-13T00:00:00Z"),
    30,
  );
  expect(metrics).toMatchObject({
    confirmed_prs: 6,
    merged_without_changes: 1,
    merged_with_changes: 1,
    merged_changes_unknown: 1,
    rejected: 1,
    pending: 2,
    long_pending: 1,
    pending_age_unknown: 1,
    duplicate_prs: 1,
    merge_ratio: 0.75,
    cost: { known_usd: 0.3, unknown_project_count: 4 },
    human_review: { total_minutes: null, unmeasured_count: 6 },
  });
});
it("only explicit trusted human feedback measures review burden and does not change preferences", async () => {
  const journal = new MemoryJournal();
  await journal.commit("delivery-1", record("1", "merged"));
  await journal.commit("preferences", { unchanged: true });
  const feedback = {
    schema_version: 1 as const,
    delivery_id: "1",
    actor: "unirain",
    recorded_at: "2026-10-13T00:00:00Z",
    reason: "more_like_this" as const,
    review_minutes: 12,
    origin: "trusted_management" as const,
  };
  await recordHumanReviewFeedback(journal, feedback);
  expect(await journal.load("preferences")).toEqual({ unchanged: true });
  expect(
    deliveryMetrics([record("1", "merged")], [feedback], {}, new Date(), 30)
      .human_review.total_minutes,
  ).toBe(12);
  await expect(
    recordHumanReviewFeedback(journal, { ...feedback, delivery_id: "made-up" }),
  ).rejects.toThrow("confirmed");
  await expect(
    recordHumanReviewFeedback(journal, { ...feedback, review_minutes: -1 }),
  ).rejects.toThrow("Invalid");
});

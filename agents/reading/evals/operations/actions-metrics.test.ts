import { expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import { collectActionsMetrics } from "../../src/monitor/actions-metrics.js";
it("records actual attempt job intervals and preserves billing/cost unknown rather than inferring charges", async () => {
  let args: unknown;
  const client = {
    paginate: async (_f: unknown, a: unknown) => {
      args = a;
      return [
        {
          id: 1,
          name: "reading",
          status: "completed",
          conclusion: "success",
          started_at: "2026-10-13T00:00:00Z",
          completed_at: "2026-10-13T00:01:30Z",
          labels: ["ubuntu-24.04"],
        },
      ];
    },
    actions: { listJobsForWorkflowRunAttempt: () => {} },
  } as unknown as Octokit;
  const metrics = await collectActionsMetrics(client, "test/impl", 42, 2);
  expect(args).toMatchObject({ run_id: 42, attempt_number: 2 });
  expect(metrics).toMatchObject({
    status: "known",
    total_job_ms: 90000,
    billed_minutes: null,
    money: { status: "unknown", amount_usd: null },
  });
});
it("running, missing timestamps and API errors remain partial/unknown and never report zero time", async () => {
  const client = {
    paginate: async () => [
      {
        id: 1,
        name: "done",
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-13T00:00:00Z",
        completed_at: "2026-10-13T00:01:00Z",
        labels: [],
      },
      {
        id: 2,
        name: "running",
        status: "in_progress",
        conclusion: null,
        started_at: "2026-10-13T00:00:00Z",
        completed_at: null,
        labels: [],
      },
    ],
    actions: { listJobsForWorkflowRunAttempt: () => {} },
  } as unknown as Octokit;
  expect(await collectActionsMetrics(client, "test/impl", 42, 1)).toMatchObject(
    {
      status: "partial",
      known_job_ms: 60000,
      total_job_ms: null,
      incomplete_jobs: 1,
    },
  );
  (client as unknown as { paginate: () => Promise<never> }).paginate =
    async () => {
      throw new Error("403");
    };
  expect(await collectActionsMetrics(client, "test/impl", 42, 1)).toMatchObject(
    {
      status: "unknown",
      total_job_ms: null,
      known_job_ms: null,
      reason: "actions_job_api_unavailable_or_inconsistent",
    },
  );
});

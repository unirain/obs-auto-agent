import type { Octokit } from "@octokit/rest";
export interface ActionsMetrics {
  schema_version: 1;
  repository: string;
  run_id: number;
  attempt: number;
  observed_at: string;
  measurement: "job_wall_clock_intervals";
  status: "known" | "partial" | "unknown";
  jobs: {
    job_id: number;
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    elapsed_ms: number | null;
    labels: string[];
  }[];
  total_job_ms: number | null;
  known_job_ms: number | null;
  incomplete_jobs: number;
  reason: string | null;
  billed_minutes: null;
  money: {
    status: "unknown";
    amount_usd: null;
    basis: "account_billing_required";
  };
}
/** Actions job timestamps measure elapsed runner work, not rounded billing or account charges. */
export async function collectActionsMetrics(
  client: Octokit,
  repository: string,
  runId: number,
  attempt: number,
  now = new Date(),
): Promise<ActionsMetrics> {
  const [owner, repo, ...rest] = repository.split("/");
  if (
    !owner ||
    !repo ||
    rest.length ||
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  )
    throw new Error("Invalid trusted Actions metrics identity");
  const view: ActionsMetrics = {
    schema_version: 1,
    repository,
    run_id: runId,
    attempt,
    observed_at: now.toISOString(),
    measurement: "job_wall_clock_intervals",
    status: "unknown",
    jobs: [],
    total_job_ms: null,
    known_job_ms: null,
    incomplete_jobs: 0,
    reason: null,
    billed_minutes: null,
    money: {
      status: "unknown",
      amount_usd: null,
      basis: "account_billing_required",
    },
  };
  try {
    const jobs = await client.paginate(
      client.actions.listJobsForWorkflowRunAttempt,
      { owner, repo, run_id: runId, attempt_number: attempt, per_page: 100 },
    );
    const unique = new Map<number, (typeof jobs)[number]>();
    for (const job of jobs) {
      const previous = unique.get(job.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(job))
        throw new Error("Actions job changed during pagination");
      unique.set(job.id, job);
    }
    view.jobs = [...unique.values()].map((job) => {
      const start = job.started_at ? Date.parse(job.started_at) : NaN,
        end = job.completed_at ? Date.parse(job.completed_at) : NaN;
      const elapsed =
        job.status === "completed" &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end >= start
          ? end - start
          : null;
      return {
        job_id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        started_at: job.started_at ?? null,
        completed_at: job.completed_at,
        elapsed_ms: elapsed,
        labels: job.labels,
      };
    });
    const known = view.jobs.filter((j) => j.elapsed_ms !== null);
    view.known_job_ms = known.length
      ? known.reduce((n, j) => n + j.elapsed_ms!, 0)
      : null;
    view.incomplete_jobs = view.jobs.length - known.length;
    view.total_job_ms =
      view.jobs.length && !view.incomplete_jobs ? view.known_job_ms : null;
    view.status =
      view.total_job_ms !== null
        ? "known"
        : known.length
          ? "partial"
          : "unknown";
    view.reason = view.incomplete_jobs
      ? "running_or_missing_job_timestamps"
      : view.jobs.length
        ? null
        : "no_job_observation";
  } catch {
    view.status = "unknown";
    view.reason = "actions_job_api_unavailable_or_inconsistent";
  }
  return view;
}

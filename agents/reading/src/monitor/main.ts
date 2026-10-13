import type { MonitorEvent } from "./source-health.js";
import { incidentKey, projectEvents } from "./source-health.js";
import { parseSourceEvent } from "./contracts.js";
import type { IssueProjector } from "./issues.js";
/** Pure control plane: no model, workspace write or image/target-repository write capability. */
export class Watchdog {
  constructor(
    private projector: IssueProjector,
    private readEvents: () => Promise<MonitorEvent[]>,
    private readSuppression: () => Promise<{
      global: boolean;
      disabled_sources: string[];
    }>,
  ) {}
  async run(): Promise<{ processed: number; projected: number }> {
    // A policy read error throws; it is never interpreted as a healthy paused system.
    const policy = await this.readSuppression();
    const events = (await this.readEvents())
      .map(parseSourceEvent)
      .filter((e) => e.execution_scope === "production");
    const groups = new Map<string, MonitorEvent[]>();
    for (const e of events)
      groups.set(incidentKey(e), [...(groups.get(incidentKey(e)) ?? []), e]);
    let projected = 0;
    for (const [key, group] of groups) {
      const current = await this.projector.current(key);
      if (current) {
        const acknowledged = group.filter(
          (e) => e.position <= current.metadata.last_position,
        );
        const proof = projectEvents(
          acknowledged,
          undefined,
          current.metadata.suppressed,
        );
        if (
          !proof ||
          proof.metadata.last_position !== current.metadata.last_position ||
          proof.metadata.status !== current.metadata.status ||
          JSON.stringify([...proof.metadata.unresolved_gaps].sort()) !==
            JSON.stringify([...current.metadata.unresolved_gaps].sort())
        )
          throw new Error(
            "Issue cursor/state contradicts persistent source events",
          );
      }
      const suppressed =
        policy.global || policy.disabled_sources.includes(group[0]!.source_id);
      if (!current && suppressed) continue; // Events remain durable in OSS, no suppressed notification.
      const result = projectEvents(group, current?.metadata, suppressed);
      if (!result) {
        if (
          current &&
          (current.metadata.status === "active") !==
            (current.issue.state === "open")
        )
          await this.projector.apply(current.metadata, false);
        continue;
      }
      await this.projector.apply(result.metadata, result.notify);
      projected++;
    }
    return { processed: events.length, projected };
  }
}

import type { Octokit } from "@octokit/rest";
import { runHealth, type ActionsRun } from "./run-health.js";
import { runtimeHours } from "../config/runtime-limits.js";
export interface WatchdogRunnerOptions {
  actions: Octokit;
  repository: string;
  workspace_id?: string;
  deployment_name?: "production" | "integration";
  projector: IssueProjector;
  readEvents: () => Promise<MonitorEvent[]>;
  readReportRunIds: () => Promise<Set<string>>;
  readPolicy: () => Promise<{
    global: boolean;
    disabled_sources: string[];
    enabled_at: string | null;
    resumed_at?: string | null;
    watchdog_gap_hours?: number;
  }>;
  now?: () => Date;
}
export async function runWatchdog(options: WatchdogRunnerOptions): Promise<{
  sources: { processed: number; projected: number };
  run_faults: number;
}> {
  const now = options.now ?? (() => new Date());
  const parts = options.repository.split("/");
  if (parts.length !== 2 || !parts.every((x) => /^[\w.-]+$/.test(x)))
    throw new Error("Invalid watchdog implementation repository");
  const workspace = options.workspace_id ?? "obs-notes-hub/reading";
  let policy: Awaited<ReturnType<typeof options.readPolicy>>;
  let reportIds: Set<string>;
  let events: MonitorEvent[];
  let runs: ActionsRun[];
  try {
    policy = await options.readPolicy();
    runtimeHours(policy.watchdog_gap_hours ?? 36, "watchdog_gap_hours");
    reportIds = await options.readReportRunIds();
    events = (await options.readEvents()).map(parseSourceEvent);
    const remote = await options.actions.paginate(
      options.actions.actions.listWorkflowRuns,
      {
        owner: parts[0]!,
        repo: parts[1]!,
        workflow_id: "reading-agent.yml",
        per_page: 100,
      },
    );
    const attempts: Array<(typeof remote)[number]> = [];
    for (const run of remote) {
      const count = run.run_attempt;
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        throw new Error("Actions attempt metadata unavailable");
      for (let attempt = 1; attempt < count; attempt++)
        attempts.push(
          (
            await options.actions.actions.getWorkflowRunAttempt({
              owner: parts[0]!,
              repo: parts[1]!,
              run_id: run.id,
              attempt_number: attempt,
            })
          ).data,
        );
      attempts.push(run);
    }
    runs = attempts.map((r) => {
      const encoded =
        /reading:([^:]+):(preview|production)(?::(production|preview|integration))?/.exec(
          r.display_title ?? "",
        );
      const id = `${r.id}-${r.run_attempt}`;
      return {
        id,
        mode:
          r.event === "schedule" ? "scheduled" : (encoded?.[1] ?? "unknown"),
        scope:
          r.event === "schedule"
            ? options.deployment_name === "integration"
              ? "different_deployment"
              : "production"
            : encoded?.[3] &&
                encoded[3] !== (options.deployment_name ?? "production")
              ? "different_deployment"
              : (encoded?.[2] ?? "unknown"),
        started_at: r.run_started_at ?? r.created_at,
        status:
          r.status === "completed"
            ? "completed"
            : r.status === "queued"
              ? "queued"
              : "in_progress",
        conclusion: r.conclusion,
        report_present:
          reportIds.has(id) ||
          (r.run_attempt === 1 && reportIds.has(String(r.id))),
        finished_at: r.updated_at,
      };
    });
  } catch (error) {
    await syntheticIncident(
      options.projector,
      workspace,
      "__monitor__",
      "read_failed",
      true,
      now(),
    );
    throw error;
  }
  const resumeAt = await policyClock(
    options.projector,
    workspace,
    policy.global,
    now(),
  );
  const effectiveResume = policy.resumed_at ?? resumeAt;
  const sources = await new Watchdog(
    options.projector,
    async () => events,
    async () => policy,
  ).run();
  // All failed/recovered completed runs are projected, not merely the latest healthy outcome.
  const runEvents = runIncidentEvents(
    runs,
    workspace,
    policy.enabled_at,
    now(),
    policy.watchdog_gap_hours ?? 36,
  );
  const runProjection = new Watchdog(
    options.projector,
    async () => runEvents,
    async () => ({ global: policy.global, disabled_sources: [] }),
  );
  if (!effectiveResume) await runProjection.run();
  else {
    // Older failures remain in the historical projection; the current missing-start obligation restarts on resume.
    await new Watchdog(
      options.projector,
      async () => runEvents.filter((e) => e.reason_code !== "missed_schedule"),
      async () => ({ global: policy.global, disabled_sources: [] }),
    ).run();
    const health = runHealth(
      runs,
      {
        enabled_at: policy.enabled_at,
        globally_paused: policy.global,
        resumed_at: effectiveResume,
        watchdog_gap_hours: policy.watchdog_gap_hours ?? 36,
      },
      now(),
    );
    await syntheticIncident(
      options.projector,
      workspace,
      "__run__",
      "missed_schedule",
      health.faults.some((f) => f.reason_code === "missed_schedule"),
      now(),
      policy.global,
      true,
    );
  }
  await syntheticIncident(
    options.projector,
    workspace,
    "__monitor__",
    "read_failed",
    false,
    now(),
  );
  const health = runHealth(
    runs,
    {
      enabled_at: policy.enabled_at,
      globally_paused: policy.global,
      watchdog_gap_hours: policy.watchdog_gap_hours ?? 36,
      ...(effectiveResume ? { resumed_at: effectiveResume } : {}),
    },
    now(),
  );
  return { sources, run_faults: health.faults.length };
}

import { runIncidentEvents } from "./run-events.js";
async function syntheticIncident(
  projector: IssueProjector,
  workspace: string,
  source: string,
  reason: string,
  active: boolean,
  now: Date,
  suppressed = false,
  createWhenActive = true,
): Promise<void> {
  const key = `${workspace}|${source}|${reason}`;
  const current = await projector.current(key);
  if (!current && (!active || suppressed || !createWhenActive)) return;
  if (
    current &&
    current.metadata.status === (active ? "active" : "recovered") &&
    current.metadata.suppressed === suppressed
  ) {
    if ((current.issue.state === "open") !== active)
      await projector.apply(current.metadata, false);
    return;
  }
  const position = Math.max(
    now.getTime() * 1000,
    (current?.metadata.last_position ?? 0) + 1,
  );
  const event: MonitorEvent = {
    event_id: `monitor-${reason}-${position}`,
    position,
    workspace_id: workspace,
    execution_scope: "production",
    source_id: source,
    reason_code: reason,
    kind: active ? "occurred" : "recovered",
    occurred_at: now.toISOString(),
  };
  const result = projectEvents([event], current?.metadata, suppressed);
  if (result) await projector.apply(result.metadata, result.notify);
}
/** Closed control Issue stores observed pause/resume times without workspace write access. */
async function policyClock(
  projector: IssueProjector,
  workspace: string,
  paused: boolean,
  now: Date,
): Promise<string | null> {
  const key = `${workspace}|__policy__|pause_clock`;
  const current = await projector.current(key);
  if (!current && !paused) return null;
  if (!current || current.metadata.suppressed !== paused) {
    const position = Math.max(
      now.getTime() * 1000,
      (current?.metadata.last_position ?? 0) + 1,
    );
    const event: MonitorEvent = {
      event_id: `policy-${paused ? "paused" : "resumed"}-${position}`,
      position,
      workspace_id: workspace,
      execution_scope: "production",
      source_id: "__policy__",
      reason_code: "pause_clock",
      kind: paused ? "occurred" : "recovered",
      occurred_at: now.toISOString(),
    };
    const result = projectEvents([event], current?.metadata, paused);
    if (result) await projector.apply(result.metadata, false);
  } else if (current.issue.state !== "closed")
    await projector.apply(current.metadata, false);
  const confirmed = await projector.current(key);
  return (
    confirmed?.metadata.events.filter((e) => e.kind === "recovered").at(-1)
      ?.occurred_at ?? null
  );
}

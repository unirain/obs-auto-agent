import type { MonitorEvent } from "./source-health.js";
import { incidentKey, projectEvents } from "./source-health.js";
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
    const events = (await this.readEvents()).filter(
      (e) => e.execution_scope === "production",
    );
    const groups = new Map<string, MonitorEvent[]>();
    for (const e of events)
      groups.set(incidentKey(e), [...(groups.get(incidentKey(e)) ?? []), e]);
    let projected = 0;
    for (const [key, group] of groups) {
      const current = await this.projector.current(key);
      if (current) {
        const acknowledged = group.filter(e => e.position <= current.metadata.last_position);
        const proof = projectEvents(acknowledged, undefined, current.metadata.suppressed);
        if (!proof || proof.metadata.last_position !== current.metadata.last_position || proof.metadata.status !== current.metadata.status || JSON.stringify([...proof.metadata.unresolved_gaps].sort()) !== JSON.stringify([...current.metadata.unresolved_gaps].sort())) throw new Error('Issue cursor/state contradicts persistent source events');
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
import type { MonitorMetadata } from "./source-health.js";
import { runHealth, type ActionsRun } from "./run-health.js";
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
  }>;
  now?: () => Date;
}
export async function runWatchdog(
  options: WatchdogRunnerOptions,
): Promise<{
  sources: { processed: number; projected: number };
  run_faults: number;
}> {
  const now = options.now ?? (() => new Date());
  const parts = options.repository.split("/");
  if (parts.length !== 2 || !parts.every((x) => /^[\w.-]+$/.test(x)))
    throw new Error("Invalid watchdog implementation repository");
  const policy = await options.readPolicy(); // Failure remains visible to Actions; no cached fallback.
  const reportIds = await options.readReportRunIds();
  const remote = await options.actions.paginate(
    options.actions.actions.listWorkflowRuns,
    {
      owner: parts[0]!,
      repo: parts[1]!,
      workflow_id: "reading-agent.yml",
      per_page: 100,
    },
  );
  const runs: ActionsRun[] = remote.map((r) => {
    const encoded =
      /reading:([^:]+):(preview|production)(?::(production|preview|integration))?/.exec(
        r.display_title ?? "",
      );
    return {
      id: String(r.id),
      mode: r.event === "schedule" ? "scheduled" : (encoded?.[1] ?? "unknown"),
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
        reportIds.has(String(r.id)) ||
        reportIds.has(`${r.id}-${r.run_attempt}`),
    };
  });
  const sources = await new Watchdog(
    options.projector,
    options.readEvents,
    async () => policy,
  ).run();
  const health = runHealth(
    runs,
    {
      enabled_at: policy.enabled_at,
      globally_paused: policy.global,
      ...(policy.resumed_at !== undefined
        ? { resumed_at: policy.resumed_at }
        : {}),
    },
    now(),
  );
  const faults = new Map(health.faults.map((f) => [f.reason_code, f]));
  for (const reason of [
    "missed_schedule",
    "report_missing",
    "failed",
    "cancelled",
  ]) {
    const key = `${options.workspace_id ?? "obs-notes-hub/reading"}|__run__|${reason}`;
    const current = await options.projector.current(key);
    if (health.suppressed) {
      if (current && !current.metadata.suppressed)
        await options.projector.apply(
          { ...current.metadata, suppressed: true },
          false,
        );
      continue;
    }
    const fault = faults.get(reason);
    if (!fault && !current) continue;
    // Recovery needs actual scheduled startup/report; no activation means monitoring was never enabled.
    const canRecover =
      policy.enabled_at &&
      (reason === "missed_schedule"
        ? runs.some((r) => r.mode === "scheduled" && r.scope === "production")
        : runs.some(
            (r) =>
              r.mode === "scheduled" &&
              r.scope === "production" &&
              r.status === "completed" &&
              r.conclusion === "success" &&
              r.report_present,
          ));
    if (!fault && !canRecover) continue;
    const position = Math.max(
      now().getTime(),
      (current?.metadata.last_position ?? 0) + 1,
    );
    const e: MonitorEvent = {
      event_id: `run-${reason}-${position}`,
      position,
      workspace_id: options.workspace_id ?? "obs-notes-hub/reading",
      execution_scope: "production",
      source_id: "__run__",
      reason_code: reason,
      kind: fault ? "occurred" : "recovered",
      occurred_at: now().toISOString(),
    };
    const projection = projectEvents([e], current?.metadata, false);
    if (projection)
      await options.projector.apply(projection.metadata, projection.notify);
  }
  return { sources, run_faults: health.faults.length };
}

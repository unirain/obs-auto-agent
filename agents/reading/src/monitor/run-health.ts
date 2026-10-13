export type RunRecord = RunReport;
import type { RunReport } from "../app/controller.js";
import { runtimeHours } from "../config/runtime-limits.js";
import { assertUtcInstant } from "../contracts/utc.js";
export interface ActionsRun {
  id: string;
  mode: string;
  scope: string;
  started_at: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  report_present: boolean;
  finished_at?: string;
}
export interface HealthFault {
  key: string;
  reason_code: string;
  detail: string;
  occurred_at: string;
}
export function runHealth(
  runs: ActionsRun[],
  policy: {
    enabled_at: string | null;
    globally_paused: boolean;
    resumed_at?: string | null;
    watchdog_gap_hours?: number;
  },
  now: Date,
): { faults: HealthFault[]; suppressed: boolean } {
  const gapHours = runtimeHours(
    policy.watchdog_gap_hours ?? 36,
    "watchdog_gap_hours",
  );
  if (policy.enabled_at !== null)
    assertUtcInstant(policy.enabled_at, "monitor enabled_at");
  if (policy.resumed_at != null)
    assertUtcInstant(policy.resumed_at, "monitor resumed_at");
  for (const run of runs) {
    assertUtcInstant(run.started_at, "Actions started_at");
    if (run.finished_at !== undefined)
      assertUtcInstant(run.finished_at, "Actions finished_at");
  }
  if (policy.globally_paused) return { faults: [], suppressed: true };
  if (!policy.enabled_at) return { faults: [], suppressed: false };
  const anchor = Math.max(
    Date.parse(policy.enabled_at),
    policy.resumed_at ? Date.parse(policy.resumed_at) : 0,
  );
  if (!Number.isFinite(anchor))
    throw new Error("Invalid monitoring activation");
  const scheduled = runs.filter(
    (r) =>
      r.mode === "scheduled" &&
      r.scope === "production" &&
      r.status !== "queued" &&
      Date.parse(r.started_at) >= anchor,
  );
  const last = Math.max(
    anchor,
    ...scheduled.map((r) => Date.parse(r.started_at)),
  );
  const faults: HealthFault[] = [];
  if (now.getTime() - last > gapHours * 3600000)
    faults.push({
      key: "run:missed_schedule",
      reason_code: "missed_schedule",
      detail: `No production scheduled startup for ${gapHours} hours`,
      occurred_at: new Date(last).toISOString(),
    });
  // A later completed scheduled run can recover a run fault; publish-only cannot.
  const latest = scheduled
    .filter((r) => r.status === "completed")
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  if (latest?.status === "completed") {
    if (latest.conclusion !== "success")
      faults.push({
        key: `run:${latest.conclusion === "cancelled" ? "cancelled" : "failed"}`,
        reason_code: latest.conclusion === "cancelled" ? "cancelled" : "failed",
        detail: `Actions run ${latest.id} ended ${latest.conclusion}`,
        occurred_at: latest.started_at,
      });
    else if (!latest.report_present)
      faults.push({
        key: "run:report_missing",
        reason_code: "report_missing",
        detail: `Actions run ${latest.id} has no committed report`,
        occurred_at: latest.started_at,
      });
  }
  return { faults, suppressed: false };
}

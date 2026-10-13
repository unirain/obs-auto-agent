import type { ActionsRun } from "./run-health.js";
import type { MonitorEvent } from "./source-health.js";
import { runtimeHours } from "../config/runtime-limits.js";
import { assertUtcInstant } from "../contracts/utc.js";
export const RUN_REASONS = [
  "missed_schedule",
  "report_missing",
  "failed",
  "cancelled",
] as const;
/** Full chronological Actions facts, including rerun attempts, produce deterministic event positions. */
export function runIncidentEvents(
  runs: ActionsRun[],
  workspace: string,
  enabledAt: string | null,
  now: Date,
  watchdogGapHours = 36,
): MonitorEvent[] {
  const gapMs =
    runtimeHours(watchdogGapHours, "watchdog_gap_hours") * 3_600_000;
  if (enabledAt !== null) assertUtcInstant(enabledAt, "monitor enabled_at");
  for (const run of runs) {
    assertUtcInstant(run.started_at, "Actions started_at");
    if (run.finished_at !== undefined)
      assertUtcInstant(run.finished_at, "Actions finished_at");
  }
  if (!enabledAt) return [];
  const anchor = Date.parse(enabledAt);
  if (!Number.isFinite(anchor))
    throw new Error("Invalid monitoring activation");
  const scheduled = runs
    .filter(
      (r) =>
        r.mode === "scheduled" &&
        r.scope === "production" &&
        r.status !== "queued" &&
        Date.parse(r.started_at) >= anchor,
    )
    .sort(
      (a, b) =>
        Date.parse(a.started_at) - Date.parse(b.started_at) ||
        a.id.localeCompare(b.id),
    );
  const events: MonitorEvent[] = [];
  const ties = new Map<string, number>();
  const emit = (
    reason: string,
    kind: "occurred" | "recovered",
    at: string,
    id: string,
  ) => {
    const clock = Date.parse(at);
    if (!Number.isFinite(clock)) throw new Error("Invalid Actions event time");
    const tieKey = `${reason}|${clock}`;
    const tie = ties.get(tieKey) ?? 0;
    if (tie >= 1000)
      throw new Error("Actions event timestamp collision overflow");
    ties.set(tieKey, tie + 1);
    const cursor = clock * 1000 + tie;
    events.push({
      event_id: `actions-${reason}-${id}-${kind}`,
      position: cursor,
      workspace_id: workspace,
      execution_scope: "production",
      source_id: "__run__",
      reason_code: reason,
      kind,
      occurred_at: at,
    });
  };
  let prior = anchor;
  let missed = false;
  const active = new Set<string>();
  for (const run of scheduled) {
    const started = Date.parse(run.started_at);
    if (!Number.isFinite(started))
      throw new Error("Invalid Actions startup time");
    if (started - prior > gapMs) {
      emit(
        "missed_schedule",
        "occurred",
        new Date(prior + gapMs).toISOString(),
        `gap-${prior}-${gapMs}`,
      );
      missed = true;
    }
    if (missed) {
      emit("missed_schedule", "recovered", run.started_at, run.id);
      missed = false;
    }
    prior = started;
  }
  for (const run of scheduled
    .filter((r) => r.status === "completed")
    .sort(
      (a, b) =>
        Date.parse(a.finished_at ?? a.started_at) -
          Date.parse(b.finished_at ?? b.started_at) || a.id.localeCompare(b.id),
    )) {
    const at = run.finished_at ?? run.started_at;
    const reason =
      run.conclusion === "success"
        ? run.report_present
          ? null
          : "report_missing"
        : run.conclusion === "cancelled"
          ? "cancelled"
          : "failed";
    if (reason) {
      if (!active.has(reason)) {
        emit(reason, "occurred", at, run.id);
        active.add(reason);
      }
    } else
      for (const current of [...active]) {
        emit(current, "recovered", at, run.id);
        active.delete(current);
      }
  }
  if (now.getTime() - prior > gapMs)
    emit(
      "missed_schedule",
      "occurred",
      new Date(prior + gapMs).toISOString(),
      `gap-${prior}-${gapMs}`,
    );
  return events;
}

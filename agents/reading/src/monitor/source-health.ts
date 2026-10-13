import type { SourceEvent } from "./contracts.js";
import { parseSourceEvent, parseMonitorMetadata } from "./contracts.js";
export type MonitorEvent = SourceEvent;
export interface MonitorMetadata {
  schema_version: 1;
  key: string;
  workspace_id: string;
  source_id: string;
  reason_code: string;
  last_position: number;
  status: "active" | "recovered" | "accepted_gap";
  suppressed: boolean;
  unresolved_gaps: string[];
  event_summary?: { total: number; first_at: string; last_at: string };
  events: {
    event_id: string;
    position: number;
    kind: string;
    occurred_at: string;
  }[];
}
export const incidentKey = (e: MonitorEvent): string =>
  `${e.workspace_id}|${e.source_id}|${e.kind === "coverage_gap" || e.kind === "gap_resolved" || e.kind === "accepted_gap" ? "coverage_gap" : e.reason_code}`;
export function projectEvents(
  events: MonitorEvent[],
  previous: MonitorMetadata | undefined,
  suppressed: boolean,
): { metadata: MonitorMetadata; notify: boolean } | null {
  events.forEach(parseSourceEvent);
  if (previous) parseMonitorMetadata(previous);
  const relevant = events
    .filter(
      (e) =>
        e.execution_scope === "production" &&
        e.position > (previous?.last_position ?? -1),
    )
    .sort((a, b) => a.position - b.position);
  if (!relevant.length)
    return previous && previous.suppressed !== suppressed
      ? {
          metadata: { ...previous, suppressed },
          notify:
            previous.suppressed && !suppressed && previous.status === "active",
        }
      : null;
  const first = relevant[0]!;
  const key = incidentKey(first);
  if (relevant.some((e) => incidentKey(e) !== key))
    throw new Error("Mixed incident keys");
  if (
    new Set(relevant.map((e) => e.position)).size !== relevant.length ||
    relevant.some(
      (e) =>
        !Number.isSafeInteger(e.position) ||
        e.position < 0 ||
        !Number.isFinite(Date.parse(e.occurred_at)),
    )
  )
    throw new Error("Invalid persistent incident order");
  let metadata: MonitorMetadata = previous
    ? structuredClone(previous)
    : {
        schema_version: 1,
        key,
        workspace_id: first.workspace_id,
        source_id: first.source_id,
        reason_code:
          first.kind === "coverage_gap" ? "coverage_gap" : first.reason_code,
        last_position: -1,
        status: "recovered",
        suppressed,
        unresolved_gaps: [],
        events: [],
      };
  let notify = false;
  for (const event of relevant) {
    const before = metadata.status;
    if (event.kind === "occurred") metadata.status = "active";
    if (event.kind === "recovered") metadata.status = "recovered";
    if (event.kind === "coverage_gap") {
      if (!event.gap_id) throw new Error("Gap interval identity missing");
      metadata.unresolved_gaps = [
        ...new Set([...metadata.unresolved_gaps, event.gap_id]),
      ];
      metadata.status = "active";
    }
    if (event.kind === "gap_resolved" || event.kind === "accepted_gap") {
      if (!event.gap_id) throw new Error("Gap disposition identity missing");
      metadata.unresolved_gaps = metadata.unresolved_gaps.filter(
        (x) => x !== event.gap_id,
      );
      metadata.status = metadata.unresolved_gaps.length
        ? "active"
        : event.kind === "accepted_gap"
          ? "accepted_gap"
          : "recovered";
    }
    if (metadata.reason_code === "coverage_gap" && event.kind === "recovered")
      throw new Error("Reading recovery cannot resolve coverage gaps");
    notify ||= before !== metadata.status;
    metadata.event_summary = {
      total: (metadata.event_summary?.total ?? metadata.events.length) + 1,
      first_at:
        metadata.event_summary?.first_at ??
        metadata.events[0]?.occurred_at ??
        event.occurred_at,
      last_at: event.occurred_at,
    };
    metadata.events.push({
      event_id: event.event_id,
      position: event.position,
      kind: event.kind,
      occurred_at: event.occurred_at,
    });
    metadata.events = metadata.events.slice(-100); // Complete event history stays in immutable OSS commits.
    metadata.last_position = event.position;
  }
  metadata.suppressed = suppressed;
  parseMonitorMetadata(metadata);
  return { metadata, notify: notify && !suppressed };
}

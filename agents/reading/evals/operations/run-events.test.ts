import { expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import { runIncidentEvents } from "../../src/monitor/run-events.js";
import { runWatchdog } from "../../src/monitor/main.js";
import {
  IssueProjector,
  decodeMetadata,
  type IssueFact,
  type IssuePort,
} from "../../src/monitor/issues.js";
import type { ActionsRun } from "../../src/monitor/run-health.js";
class Issues implements IssuePort {
  items: IssueFact[] = [];
  notices: string[] = [];
  async list() {
    return structuredClone(this.items);
  }
  async create(_t: string, body: string) {
    const i: IssueFact = { number: this.items.length + 1, body, state: "open" };
    this.items.push(i);
    return structuredClone(i);
  }
  async update(n: number, body: string, state: "open" | "closed") {
    Object.assign(this.items.find((i) => i.number === n)!, { body, state });
  }
  async comments() {
    return this.notices;
  }
  async comment(_n: number, body: string) {
    this.notices.push(body);
  }
}
const run = (
  id: string,
  start: string,
  conclusion = "success",
  report = true,
): ActionsRun => ({
  id,
  mode: "scheduled",
  scope: "production",
  started_at: start,
  finished_at: start,
  status: "completed",
  conclusion,
  report_present: report,
});
it("offline Actions failure/cancellation/missing-report then healthy run remain occurred+recovered facts", () => {
  const events = runIncidentEvents(
    [
      run("1", "2026-10-10T00:00:00Z", "failure"),
      run("2", "2026-10-10T01:00:00Z", "cancelled"),
      run("3", "2026-10-10T02:00:00Z", "success", false),
      run("4", "2026-10-10T03:00:00Z"),
    ],
    "w",
    "2026-10-10T00:00:00Z",
    new Date("2026-10-10T04:00:00Z"),
  );
  for (const reason of ["failed", "cancelled", "report_missing"])
    expect(
      events.filter((e) => e.reason_code === reason).map((e) => e.kind),
    ).toEqual(["occurred", "recovered"]);
  const earlier = events.map((e) => ({ id: e.event_id, position: e.position }));
  const later = runIncidentEvents(
    [
      run("1", "2026-10-10T00:00:00Z", "failure"),
      run("2", "2026-10-10T01:00:00Z", "cancelled"),
      run("3", "2026-10-10T02:00:00Z", "success", false),
      run("4", "2026-10-10T03:00:00Z"),
      run("5", "2026-10-10T04:00:00Z"),
    ],
    "w",
    "2026-10-10T00:00:00Z",
    new Date("2026-10-10T05:00:00Z"),
  );
  expect(later.map((e) => ({ id: e.event_id, position: e.position }))).toEqual(
    earlier,
  );
});
it("queued and publish-only do not clear startup gaps; missed gap before later startup is retained", () => {
  const events = runIncidentEvents(
    [
      { ...run("q", "2026-10-12T00:00:00Z"), status: "queued" },
      { ...run("p", "2026-10-12T00:00:00Z"), mode: "publish-only" },
      run("later", "2026-10-13T00:00:00Z"),
    ],
    "w",
    "2026-10-10T00:00:00Z",
    new Date("2026-10-13T01:00:00Z"),
  );
  expect(
    events
      .filter((e) => e.reason_code === "missed_schedule")
      .map((e) => e.kind),
  ).toEqual(["occurred", "recovered"]);
});
it("runner reads prior attempt after rerun, deduplicates report by attempt and projects recovery without duplicate notice", async () => {
  const port = new Issues();
  const original = {
    id: 42,
    run_attempt: 1,
    event: "schedule",
    display_title: "reading:scheduled:production:production",
    run_started_at: "2026-10-13T00:00:00Z",
    created_at: "2026-10-13T00:00:00Z",
    updated_at: "2026-10-13T00:10:00Z",
    status: "completed",
    conclusion: "cancelled",
  };
  const latest = {
    ...original,
    run_attempt: 2,
    run_started_at: "2026-10-13T01:00:00Z",
    updated_at: "2026-10-13T01:10:00Z",
    conclusion: "success",
  };
  let attempts = 0;
  const actions = {
    paginate: async () => [latest],
    actions: {
      listWorkflowRuns: () => {},
      getWorkflowRunAttempt: async () => {
        attempts++;
        return { data: original };
      },
    },
  } as unknown as Octokit;
  const options = {
    actions,
    repository: "test/implementation",
    workspace_id: "w",
    projector: new IssueProjector(port, async () => {}),
    readEvents: async () => [],
    readReportRunIds: async () => new Set(["42-2"]),
    readPolicy: async () => ({
      global: false,
      disabled_sources: [],
      enabled_at: "2026-10-13T00:00:00Z",
    }),
    now: () => new Date("2026-10-13T02:00:00Z"),
  };
  await runWatchdog(options);
  expect(attempts).toBe(1);
  const fault = port.items.find(
    (i) => decodeMetadata(i.body)?.reason_code === "cancelled",
  )!;
  expect(fault.state).toBe("closed");
  expect(decodeMetadata(fault.body)?.events.map((e) => e.kind)).toEqual([
    "occurred",
    "recovered",
  ]);
  await runWatchdog(options);
  expect(port.notices).toEqual([]);
  expect(port.items).toHaveLength(1);
});
it("observed long pause then resume starts a new 36-hour baseline, while source incidents stay active", async () => {
  const port = new Issues();
  let paused = true;
  let now = new Date("2026-10-10T00:00:00Z");
  const actions = {
    paginate: async () => [],
    actions: { listWorkflowRuns: () => {} },
  } as unknown as Octokit;
  const options = {
    actions,
    repository: "test/implementation",
    workspace_id: "w",
    projector: new IssueProjector(port, async () => {}),
    readEvents: async () => [
      {
        event_id: "s1",
        position: 1,
        workspace_id: "w",
        execution_scope: "production" as const,
        source_id: "A",
        reason_code: "fetch_failed",
        kind: "occurred" as const,
        occurred_at: "2026-10-09T00:00:00Z",
      },
    ],
    readReportRunIds: async () => new Set<string>(),
    readPolicy: async () => ({
      global: paused,
      disabled_sources: [],
      enabled_at: "2026-10-09T00:00:00Z",
    }),
    now: () => now,
  };
  await runWatchdog(options);
  expect(port.items.every((i) => i.state === "closed")).toBe(true);
  paused = false;
  now = new Date("2026-10-20T00:00:00Z");
  await runWatchdog(options);
  expect(
    port.items.find((i) => decodeMetadata(i.body)?.source_id === "A")?.state,
  ).toBe("open");
  expect(
    port.items.some(
      (i) => decodeMetadata(i.body)?.reason_code === "missed_schedule",
    ),
  ).toBe(false);
  now = new Date("2026-10-21T13:00:00Z");
  await runWatchdog(options);
  expect(
    port.items.find(
      (i) => decodeMetadata(i.body)?.reason_code === "missed_schedule",
    )?.state,
  ).toBe("open");
});
it("watchdog API/read failure is visible as a deduplicated monitoring incident and never healthy", async () => {
  const port = new Issues();
  let fail = true;
  const options = {
    actions: {
      paginate: async () => [],
      actions: { listWorkflowRuns: () => {} },
    } as unknown as Octokit,
    repository: "test/implementation",
    workspace_id: "w",
    projector: new IssueProjector(port, async () => {}),
    readEvents: async () => [],
    readReportRunIds: async () => new Set<string>(),
    readPolicy: async () => {
      if (fail) throw new Error("policy unavailable");
      return { global: false, disabled_sources: [], enabled_at: null };
    },
    now: () => new Date("2026-10-13T00:00:00Z"),
  };
  await expect(runWatchdog(options)).rejects.toThrow("policy unavailable");
  await expect(runWatchdog(options)).rejects.toThrow();
  expect(port.items).toHaveLength(1);
  expect(port.items[0]?.state).toBe("open");
  fail = false;
  await runWatchdog(options);
  expect(port.items[0]?.state).toBe("closed");
  expect(port.notices).toHaveLength(1);
});
it("runner consumes trusted custom gap and deduplicates the same persistent incident on the next poll", async () => {
  const port = new Issues();
  const options = {
    actions: { paginate: async () => [], actions: { listWorkflowRuns: () => {} } } as unknown as Octokit,
    repository: "test/implementation",
    workspace_id: "w",
    projector: new IssueProjector(port, async () => {}),
    readEvents: async () => [],
    readReportRunIds: async () => new Set<string>(),
    readPolicy: async () => ({ global: false, disabled_sources: [], enabled_at: "2026-10-13T00:00:00Z", watchdog_gap_hours: 2 }),
    now: () => new Date("2026-10-13T03:00:00Z"),
  };
  expect((await runWatchdog(options)).run_faults).toBe(1);
  expect(port.items).toHaveLength(1);
  expect(port.items[0]?.state).toBe("open");
  expect(decodeMetadata(port.items[0]!.body)?.events[0]?.occurred_at).toBe("2026-10-13T02:00:00.000Z");
  expect((await runWatchdog(options)).run_faults).toBe(1);
  expect(port.items).toHaveLength(1);
  expect(port.notices).toEqual([]);
});

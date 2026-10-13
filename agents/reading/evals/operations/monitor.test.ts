import { describe, expect, it } from "vitest";
import {
  IssueProjector,
  decodeMetadata,
  type IssuePort,
  type IssueFact,
} from "../../src/monitor/issues.js";
import { Watchdog } from "../../src/monitor/main.js";
import { runHealth } from "../../src/monitor/run-health.js";
import type { MonitorEvent } from "../../src/monitor/source-health.js";
class Issues implements IssuePort {
  issues: IssueFact[] = [];
  notices: string[] = [];
  writes = 0;
  lose: "create" | "comment" | "update" | null = null;
  async list() {
    return structuredClone(this.issues);
  }
  async create(_title: string, body: string) {
    this.writes++;
    const i: IssueFact = {
      number: this.issues.length + 1,
      body,
      state: "open",
    };
    this.issues.push(i);
    if (this.lose === "create") {
      this.lose = null;
      throw new Error("create response lost");
    }
    return structuredClone(i);
  }
  async update(number: number, body: string, state: "open" | "closed") {
    this.writes++;
    Object.assign(this.issues.find((i) => i.number === number)!, {
      body,
      state,
    });
    if (this.lose === "update") {
      this.lose = null;
      throw new Error("update response lost");
    }
  }
  async comments() {
    return [...this.notices];
  }
  async comment(_n: number, body: string) {
    this.notices.push(body);
    if (this.lose === "comment") {
      this.lose = null;
      throw new Error("comment response lost");
    }
  }
}
const event = (
  position: number,
  kind: MonitorEvent["kind"] = "occurred",
  reason = "fetch_failed",
  source = "A",
): MonitorEvent => ({
  event_id: `e${position}`,
  position,
  workspace_id: "obs-notes-hub/reading",
  execution_scope: "production",
  source_id: source,
  reason_code: reason,
  kind,
  occurred_at: `2026-10-13T${String(position).padStart(2, "0")}:00:00Z`,
});
const watchdog = (port: Issues, events: MonitorEvent[], paused = false) =>
  new Watchdog(
    new IssueProjector(port, async () => {}),
    async () => events,
    async () => ({ global: paused, disabled_sources: [] }),
  );
describe("durable source incident projection", () => {
  it("a source failure is visible despite another source succeeding; repeats do not spam", async () => {
    const port = new Issues();
    const events = [event(1), event(2, "recovered", "fetch_failed", "B")];
    await watchdog(port, events).run();
    expect(port.issues).toHaveLength(2);
    expect(port.issues[0]!.state).toBe("open");
    expect(decodeMetadata(port.issues[0]!.body)?.source_id).toBe("A");
    const writes = port.writes;
    await watchdog(port, events).run();
    expect(port.writes).toBe(writes);
    expect(port.notices).toEqual([]);
    events.push(event(3));
    await watchdog(port, events).run();
    expect(port.notices).toEqual([]);
    expect(decodeMetadata(port.issues[0]!.body)?.last_position).toBe(3);
  });
  it("offline occurred+recovered events remain recorded even when final outcome healthy", async () => {
    const port = new Issues();
    await watchdog(port, [event(1), event(2, "recovered")]).run();
    expect(port.issues).toHaveLength(1);
    expect(port.issues[0]!.state).toBe("closed");
    expect(
      decodeMetadata(port.issues[0]!.body)?.events.map((e) => e.kind),
    ).toEqual(["occurred", "recovered"]);
  });
  it.each(["create", "update", "comment"] as const)(
    "lost %s response reconciles Issue/comment IDs next run",
    async (boundary) => {
      const port = new Issues();
      const events = [event(1)];
      if (boundary !== "create") await watchdog(port, events).run();
      if (boundary !== "create") events.push(event(2, "recovered"));
      port.lose = boundary;
      await expect(watchdog(port, events).run()).rejects.toThrow(
        "response lost",
      );
      await watchdog(port, events).run();
      expect(port.issues).toHaveLength(1);
      expect(port.notices.length).toBeLessThanOrEqual(1);
      expect(decodeMetadata(port.issues[0]!.body)?.last_position).toBe(
        events.at(-1)!.position,
      );
    },
  );
  it("read recovery does not close gaps; acceptance and verified fill resolve independent intervals", async () => {
    const port = new Issues();
    const events = [
      event(1),
      { ...event(2, "coverage_gap", "coverage_gap"), gap_id: "g1" },
      event(3, "recovered"),
    ];
    await watchdog(port, events).run();
    expect(port.issues[0]!.state).toBe("closed");
    expect(port.issues[1]!.state).toBe("open");
    events.push({ ...event(4, "accepted_gap", "coverage_gap"), gap_id: "g1" });
    await watchdog(port, events).run();
    expect(decodeMetadata(port.issues[1]!.body)?.status).toBe("accepted_gap");
    expect(port.issues[1]!.state).toBe("closed");
    events.push({ ...event(5, "coverage_gap", "coverage_gap"), gap_id: "g2" });
    await watchdog(port, events).run();
    expect(port.issues[1]!.state).toBe("open");
    events.push({ ...event(6, "gap_resolved", "coverage_gap"), gap_id: "g2" });
    await watchdog(port, events).run();
    expect(decodeMetadata(port.issues[1]!.body)?.status).toBe("recovered");
  });
  it("suppression retains fault history; preview never issues; policy read failure never means healthy", async () => {
    const port = new Issues();
    await watchdog(port, [event(1)], true).run();
    expect(port.issues).toEqual([]);
    await watchdog(port, [event(1)]).run();
    expect(port.issues[0]!.state).toBe("open");
    await watchdog(port, [event(1)], true).run();
    expect(decodeMetadata(port.issues[0]!.body)?.status).toBe("active");
    expect(decodeMetadata(port.issues[0]!.body)?.suppressed).toBe(true);
    await watchdog(port, [{ ...event(2), execution_scope: "preview" }]).run();
    expect(port.issues).toHaveLength(1);
    const broken = new Watchdog(
      new IssueProjector(port, async () => {}),
      async () => [],
      async () => {
        throw new Error("policy unavailable");
      },
    );
    await expect(broken.run()).rejects.toThrow("policy unavailable");
  });
});
describe("independent schedule monitoring", () => {
  const policy = { enabled_at: "2026-10-10T00:00:00Z", globally_paused: false };
  const now = new Date("2026-10-13T00:00:00Z");
  it("publish-only does not hide a missed scheduled run", () => {
    expect(
      runHealth(
        [
          {
            id: "1",
            mode: "publish-only",
            scope: "production",
            started_at: "2026-10-12T20:00:00Z",
            status: "completed",
            conclusion: "success",
            report_present: true,
          },
        ],
        policy,
        now,
      ).faults[0]?.reason_code,
    ).toBe("missed_schedule");
  });
  it("waits for an unfinished run but warns completed report missing or failure", () => {
    const run = {
      id: "1",
      mode: "scheduled",
      scope: "production",
      started_at: "2026-10-12T20:00:00Z",
      status: "in_progress" as const,
      conclusion: null,
      report_present: false,
    };
    expect(runHealth([run], policy, now).faults).toEqual([]);
    expect(
      runHealth(
        [{ ...run, status: "completed", conclusion: "success" }],
        policy,
        now,
      ).faults[0]?.reason_code,
    ).toBe("report_missing");
    expect(
      runHealth(
        [{ ...run, status: "completed", conclusion: "cancelled" }],
        policy,
        now,
      ).faults[0]?.reason_code,
    ).toBe("cancelled");
  });
  it("pause suppresses and resumption recalculates 36-hour expectation without fake recovery", () => {
    expect(
      runHealth([], { ...policy, globally_paused: true }, now).suppressed,
    ).toBe(true);
    expect(
      runHealth([], { ...policy, resumed_at: "2026-10-12T20:00:00Z" }, now)
        .faults,
    ).toEqual([]);
  });
});

it('editing Issue machine state cannot invent source recovery or skip persisted events',async()=>{
  const {issueBody}=await import('../../src/monitor/issues.js');const port=new Issues();const events=[event(1)];await watchdog(port,events).run();
  const original=decodeMetadata(port.issues[0]!.body)!;port.issues[0]!.body=issueBody({...original,status:'recovered'},port.issues[0]!.body);
  await expect(watchdog(port,events).run()).rejects.toThrow('contradicts persistent');
  port.issues[0]!.body=issueBody({...original,last_position:9999},port.issues[0]!.body);await expect(watchdog(port,events).run()).rejects.toThrow('contradicts persistent');
});

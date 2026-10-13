import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { parseRuntimeLimits, runtimeHours } from "../../src/config/runtime-limits.js";
import { runHealth } from "../../src/monitor/run-health.js";
import { runIncidentEvents } from "../../src/monitor/run-events.js";

const runtime = () => parse(readFileSync("agents/reading/runtime.yaml", "utf8")) as Record<string, unknown>;
it("parses the actual trusted YAML and rejects configuration that capacity does not enforce", () => {
  expect(parseRuntimeLimits(runtime())).toEqual({
    watchdog_gap_hours: 36,
    sources_freshness_hours: 24,
    storage_limit_bytes: 50_000_000_000,
    storage_warning_bytes: 45_000_000_000,
    storage_stop_generation_bytes: 49_000_000_000,
  });
  for (const [key, value] of [
    ["schema_version", 2], ["cost_policy", "enforce"],
    ["storage_limit_bytes", 51_000_000_000], ["storage_limit_bytes", "50000000000"],
    ["storage_warning_bytes", 44_000_000_000], ["storage_stop_generation_bytes", 48_000_000_000],
  ] as const)
    expect(() => parseRuntimeLimits({ ...runtime(), [key]: value })).toThrow();
});
it("rejects missing, coercible, nonfinite, zero, negative and sub-millisecond hour values", () => {
  for (const bad of [undefined, null, "24", true, NaN, Infinity, -1, 0, 1e-12, Number.MAX_VALUE]) {
    expect(() => runtimeHours(bad, "watchdog_gap_hours")).toThrow();
    for (const field of ["watchdog_gap_hours", "sources_freshness_hours"])
      expect(() => parseRuntimeLimits({ ...runtime(), [field]: bad })).toThrow();
  }
  expect(runtimeHours(0.5, "sources_freshness_hours")).toBe(0.5);
});
it("uses custom watchdog duration at the boundary in health and immutable chronological events", () => {
  const policy = { enabled_at: "2026-10-13T00:00:00Z", globally_paused: false, watchdog_gap_hours: 2 };
  const exact = new Date("2026-10-13T02:00:00Z");
  expect(runHealth([], policy, exact).faults).toEqual([]);
  expect(runIncidentEvents([], "w", policy.enabled_at, exact, 2)).toEqual([]);
  const later = new Date("2026-10-13T02:00:01Z");
  expect(runHealth([], policy, later).faults[0]?.detail).toContain("2 hours");
  expect(runIncidentEvents([], "w", policy.enabled_at, later, 2)[0]).toMatchObject({
    occurred_at: "2026-10-13T02:00:00.000Z", kind: "occurred",
  });
  expect(() => runHealth([], { ...policy, globally_paused: true, watchdog_gap_hours: NaN }, later)).toThrow();
  expect(() => runIncidentEvents([], "w", null, later, 0)).toThrow();
});

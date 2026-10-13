import { expect, it } from "vitest";
import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  MONITOR_SCHEMA_DOCUMENTS,
  parseSourceEvent,
  parseSourceHealth,
  parseMonitorMetadata,
} from "../../src/monitor/contracts.js";
import {
  PUBLISH_SCHEMA_DOCUMENTS,
  parseResourceReceipt,
  parseDeliveryRecord,
  parseHumanReviewFeedback,
  parseStoredDelivery,
} from "../../src/publish/contracts.js";
import { projectEvents } from "../../src/monitor/source-health.js";
import { sealed } from "../delivery/helpers.js";
import { CONFIG_SCHEMA_DOCUMENTS } from "../../src/config/schemas.js";
import { parseDeployment } from "../../src/config/deployment.js";
const instant = "2026-10-13T00:00:00Z";
const event = {
  event_id: "e1",
  position: 1,
  workspace_id: "obs-notes-hub/reading",
  execution_scope: "production",
  source_id: "a",
  reason_code: "fetch_failed",
  kind: "occurred",
  occurred_at: instant,
};
const health = {
  schema_version: 1,
  events: [event],
  active: {
    "a:fetch_failed": {
      first_seen_at: instant,
      last_seen_at: instant,
      consecutive_failures: 1,
    },
  },
  gaps: { g1: { from: instant, to: instant, status: "open" } },
  last_success: { a: instant },
};
const receipt = {
  object_key: "reading-agent/p1/" + "a".repeat(64) + ".png",
  sha256: "a".repeat(64),
  bytes: 1,
  mime: "image/png",
  url: "https://image.example/a.png",
  project_id: "p1",
  version_id: null,
  confirmed_at: instant,
};
const d = sealed();
const values: Record<string, unknown> = {
  deployment: {
    ...JSON.parse(
      readFileSync("agents/reading/deploy/examples/preview.json", "utf8"),
    ),
    enabled_at: instant,
  },
  "source-event": event,
  "source-health": health,
  "monitor-metadata": projectEvents(
    [parseSourceEvent(event)],
    undefined,
    false,
  )!.metadata,
  "resource-receipt": receipt,
  delivery: {
    ...d,
    resources: [receipt],
    files: d.files.map(({ content, ...file }) => ({
      ...file,
      content_base64: Buffer.from(content).toString("base64"),
    })),
  },
  "delivery-record": {
    schema_version: 1,
    delivery_id: "d1",
    project_id: "p1",
    generation_version: 1,
    branch: "notes/p1/g1",
    status: "publishing",
    prepared: {
      base_commit: "a".repeat(40),
      base_tree: "b".repeat(40),
      tree_sha: "c".repeat(40),
      commit_sha: "d".repeat(40),
      message: "note",
      identity: { name: "Bot", email: "bot@example.com", date: instant },
      blobs: [],
      files: [],
    },
    pr: {
      number: 1,
      url: "https://github.com/test/repo/pull/1",
      state: "open",
      branch: "notes/p1/g1",
      head_sha: "d".repeat(40),
      delivery_id: "d1",
      created_at: instant,
      closed_at: null,
      merged_at: null,
    },
    uncertain_action: null,
    reason: null,
    updated_at: instant,
    policy_checks: [
      {
        action: "create_pr",
        status: "legacy_unverified",
        evidence: null,
        checked_at: instant,
      },
    ],
  },
  "human-review-feedback": {
    schema_version: 1,
    delivery_id: "d1",
    actor: "unirain",
    recorded_at: instant,
    reason: null,
    review_minutes: null,
    origin: "trusted_management",
    pr_binding: {
      repository: "test/repo",
      number: 1,
      url: "https://github.com/test/repo/pull/1",
      head_sha: "a".repeat(40),
      state: "open",
      checked_at: instant,
    },
  },
};
const parses: Record<string, (v: unknown) => unknown> = {
  deployment: parseDeployment,
  "source-event": parseSourceEvent,
  "source-health": parseSourceHealth,
  "monitor-metadata": parseMonitorMetadata,
  "resource-receipt": parseResourceReceipt,
  delivery: parseStoredDelivery,
  "delivery-record": parseDeliveryRecord,
  "human-review-feedback": parseHumanReviewFeedback,
};
const invalid = [
  "2026-10-13",
  "2026-10-13T00:00:00",
  "2026-10-13T00:00:00+08:00",
  "2026-02-30T00:00:00Z",
  "1900-02-29T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-10-13T24:00:00Z",
  "2026-10-13T00:00:60Z",
];
const timeKeys = new Set([
  "enabled_at",
  "occurred_at",
  "first_seen_at",
  "last_seen_at",
  "from",
  "to",
  "first_at",
  "last_at",
  "confirmed_at",
  "sources_verified_at",
  "updated_at",
  "recorded_at",
  "checked_at",
  "created_at",
  "closed_at",
  "merged_at",
  "date",
]);
function timestamps(
  value: unknown,
  path: (string | number)[] = [],
): (string | number)[][] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) =>
    typeof v === "string" &&
    (timeKeys.has(key) || path.at(-1) === "last_success")
      ? [[...path, key]]
      : timestamps(v, [...path, key]),
  );
}
function mutate(
  value: unknown,
  path: (string | number)[],
  time: string,
): unknown {
  const next = structuredClone(value);
  let part = next as Record<string, unknown>;
  for (const key of path.slice(0, -1))
    part = part[key] as Record<string, unknown>;
  part[path.at(-1)!] = time;
  return next;
}
it("exported contracts and public schema documents agree on real calendar UTC, version and exact shape cases", () => {
  const ajv = new Ajv({ allErrors: true });
  for (const definition of [
    ...CONFIG_SCHEMA_DOCUMENTS,
    ...MONITOR_SCHEMA_DOCUMENTS,
    ...PUBLISH_SCHEMA_DOCUMENTS,
  ]) {
    const raw = JSON.parse(
      readFileSync("agents/reading/schemas/" + definition.file, "utf8"),
    ) as Record<string, unknown>;
    const { $schema, $id, ...document } = raw;
    expect(document).toEqual(JSON.parse(JSON.stringify(definition.schema))); // drift guard, separate from the oracle cases below
    const exported = TypeCompiler.Compile(definition.schema),
      published = ajv.compile(raw),
      base = values[definition.name];
    const verify = (sample: unknown, expected: boolean) => {
      expect(exported.Check(sample), definition.name).toBe(expected);
      expect(published(sample), definition.name).toBe(expected);
      if (expected)
        expect(() => parses[definition.name]!(sample)).not.toThrow();
      else expect(() => parses[definition.name]!(sample)).toThrow();
    };
    verify(base, true);
    verify({ ...(base as object), unexpected_model_config: true }, false);
    if (definition.name !== "resource-receipt")
      verify({ ...(base as object), schema_version: 2 }, false);
    for (const path of timestamps(base)) {
      for (const time of invalid) verify(mutate(base, path, time), false);
      // Valid leap day/seconds/fractions remain unchanged. Other fields retain their dates, so parser interval checks are assessed separately.
      for (const time of [instant, "2026-10-13T00:00:00.000Z"])
        verify(mutate(base, path, time), true);
    }
  }
});
it("source state rejects missing collections, unknown gap dispositions and nonconsecutive ordering without migration", () => {
  expect(() => parseSourceHealth({ schema_version: 1, events: [] })).toThrow();
  expect(() => parseSourceHealth({ ...health, schema_version: 2 })).toThrow();
  expect(() =>
    parseSourceHealth({
      ...health,
      gaps: { g1: { ...health.gaps.g1, status: "auto_resolved" } },
    }),
  ).toThrow();
  expect(() =>
    parseSourceHealth({
      ...health,
      events: [event, { ...event, event_id: "e2" }],
    }),
  ).toThrow("order");
  expect(() => parseSourceEvent({ ...event, kind: "gap_resolved" })).toThrow();
  expect(
    parseSourceEvent({ ...event, kind: "coverage_gap", gap_id: "g1" }).gap_id,
  ).toBe("g1");
  expect(
    parseSourceEvent({ ...event, occurred_at: "2000-02-29T12:00:00.1Z" })
      .occurred_at,
  ).toBe("2000-02-29T12:00:00.1Z");
});

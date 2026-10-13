import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { UtcInstantSchema } from "../contracts/utc.js";
const exact = { additionalProperties: false };
const text = Type.String({ minLength: 1 });
const position = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const SourceEventKindSchema = Type.Union(
  (
    [
      "occurred",
      "recovered",
      "coverage_gap",
      "accepted_gap",
      "gap_resolved",
    ] as const
  ).map((v) => Type.Literal(v)),
);
const eventFields = {
  event_id: text,
  position,
  workspace_id: text,
  execution_scope: Type.Union([
    Type.Literal("production"),
    Type.Literal("preview"),
  ]),
  source_id: text,
  reason_code: text,
  occurred_at: UtcInstantSchema,
};
export const SourceEventSchema = Type.Union([
  Type.Object(
    {
      ...eventFields,
      kind: Type.Union([Type.Literal("occurred"), Type.Literal("recovered")]),
      gap_id: Type.Optional(text),
    },
    exact,
  ),
  Type.Object(
    {
      ...eventFields,
      kind: Type.Union([
        Type.Literal("coverage_gap"),
        Type.Literal("accepted_gap"),
        Type.Literal("gap_resolved"),
      ]),
      gap_id: text,
    },
    exact,
  ),
]);
export const SourceHealthSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    events: Type.Array(SourceEventSchema),
    active: Type.Record(
      Type.String({ pattern: "^.+$" }),
      Type.Object(
        {
          first_seen_at: UtcInstantSchema,
          last_seen_at: UtcInstantSchema,
          consecutive_failures: Type.Integer({
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          }),
        },
        exact,
      ),
    ),
    gaps: Type.Record(
      Type.String({ pattern: "^.+$" }),
      Type.Object(
        {
          from: UtcInstantSchema,
          to: UtcInstantSchema,
          status: Type.Union(
            (["open", "accepted", "filled"] as const).map((v) =>
              Type.Literal(v),
            ),
          ),
        },
        exact,
      ),
    ),
    last_success: Type.Record(
      Type.String({ pattern: "^.+$" }),
      UtcInstantSchema,
    ),
  },
  exact,
);
export const MonitorMetadataSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    key: text,
    workspace_id: text,
    source_id: text,
    reason_code: text,
    last_position: position,
    status: Type.Union(
      (["active", "recovered", "accepted_gap"] as const).map((v) =>
        Type.Literal(v),
      ),
    ),
    suppressed: Type.Boolean(),
    unresolved_gaps: Type.Array(text),
    event_summary: Type.Optional(
      Type.Object(
        {
          total: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          first_at: UtcInstantSchema,
          last_at: UtcInstantSchema,
        },
        exact,
      ),
    ),
    events: Type.Array(
      Type.Object(
        {
          event_id: text,
          position,
          kind: SourceEventKindSchema,
          occurred_at: UtcInstantSchema,
        },
        exact,
      ),
      { maxItems: 100 },
    ),
  },
  exact,
);
export type SourceEvent = {
  event_id: string;
  position: number;
  workspace_id: string;
  execution_scope: "production" | "preview";
  source_id: string;
  reason_code: string;
  kind: Static<typeof SourceEventKindSchema>;
  occurred_at: string;
  gap_id?: string;
};
export type SourceHealth = Omit<Static<typeof SourceHealthSchema>, "events"> & {
  events: SourceEvent[];
};
export const MONITOR_SCHEMA_DOCUMENTS = [
  {
    name: "source-event",
    file: "source-event.schema.json",
    schema: SourceEventSchema,
  },
  {
    name: "source-health",
    file: "source-health.schema.json",
    schema: SourceHealthSchema,
  },
  {
    name: "monitor-metadata",
    file: "monitor-metadata.schema.json",
    schema: MonitorMetadataSchema,
  },
];
const sourceEvent = TypeCompiler.Compile(SourceEventSchema);
const sourceHealth = TypeCompiler.Compile(SourceHealthSchema);
const monitorMetadata = TypeCompiler.Compile(MonitorMetadataSchema);
export function parseSourceEvent(value: unknown): SourceEvent {
  if (!sourceEvent.Check(value))
    throw new Error("Invalid SourceEvent schema/UTC");
  if (
    ["coverage_gap", "accepted_gap", "gap_resolved"].includes(value.kind) &&
    !value.gap_id
  )
    throw new Error("SourceEvent gap identity missing");
  return value;
}
export function parseSourceHealth(value: unknown): SourceHealth {
  if (!sourceHealth.Check(value))
    throw new Error("Invalid SourceHealth schema/UTC");
  let prior = -1;
  const ids = new Set<string>();
  for (const event of value.events) {
    parseSourceEvent(event);
    if (event.position <= prior || ids.has(event.event_id))
      throw new Error("Invalid SourceHealth event order");
    prior = event.position;
    ids.add(event.event_id);
  }
  for (const incident of Object.values(value.active))
    if (Date.parse(incident.first_seen_at) > Date.parse(incident.last_seen_at))
      throw new Error("Invalid SourceHealth incident interval");
  for (const gap of Object.values(value.gaps))
    if (Date.parse(gap.from) > Date.parse(gap.to))
      throw new Error("Invalid SourceHealth gap interval");
  return value;
}
export function parseMonitorMetadata(
  value: unknown,
): Static<typeof MonitorMetadataSchema> {
  if (!monitorMetadata.Check(value))
    throw new Error("Invalid Issue monitoring metadata schema/UTC");
  let prior = -1;
  const ids = new Set<string>();
  for (const event of value.events) {
    if (
      event.position <= prior ||
      event.position > value.last_position ||
      ids.has(event.event_id)
    )
      throw new Error("Invalid Issue monitoring event order");
    prior = event.position;
    ids.add(event.event_id);
  }
  if (
    value.events.length &&
    value.events.at(-1)?.position !== value.last_position
  )
    throw new Error("Invalid Issue monitoring cursor");
  if (
    value.event_summary &&
    (value.event_summary.total < value.events.length ||
      Date.parse(value.event_summary.first_at) >
        Date.parse(value.event_summary.last_at))
  )
    throw new Error("Invalid Issue monitoring summary");
  if (
    value.key !==
    `${value.workspace_id}|${value.source_id}|${value.reason_code}`
  )
    throw new Error("Invalid Issue monitoring identity");
  return value;
}

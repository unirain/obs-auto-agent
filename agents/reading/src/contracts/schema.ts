import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { AgentError, canonicalJson, type InvocationRecord } from "./index.js";
import { UtcInstantSchema } from "./utc.js";
export { UtcInstantSchema } from "./utc.js";
const identity = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-zA-Z0-9_-]+$",
});
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const scope = Type.Union([Type.Literal("production"), Type.Literal("preview")]);
const nullable = <T extends TSchema>(s: T) => Type.Union([s, Type.Null()]);
const exact = { additionalProperties: false };
export const ManifestFileSchema = Type.Object(
  {
    path: Type.String(),
    sha256: hash,
    size: Type.Integer({ minimum: 0, maximum: 50_000_000_000 }),
    chunks: Type.Optional(
      Type.Array(
        Type.Object(
          {
            sha256: hash,
            size: Type.Integer({ minimum: 1, maximum: 33554432 }),
          },
          exact,
        ),
        { minItems: 2, maxItems: 4096 },
      ),
    ),
    role: Type.Union(
      ["control", "input", "evidence", "artifact", "output", "report"].map(
        (v) => Type.Literal(v),
      ),
    ),
    project_id: nullable(Type.String()),
  },
  exact,
);
export const WorkspaceSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    workspace_id: Type.String(),
    execution_scope: scope,
    revision: identity,
    parent_revision: nullable(identity),
    run_id: Type.String(),
    checkpoint_reason: Type.String(),
    created_at: UtcInstantSchema,
    files: Type.Array(ManifestFileSchema),
  },
  exact,
);
export const CheckpointSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    sequence: Type.String({ pattern: "^[0-9]{20}$" }),
    workspace_id: Type.String(),
    execution_scope: scope,
    revision: identity,
    manifest_key: Type.String(),
    manifest_sha256: hash,
    parent_commit_key: nullable(Type.String()),
    parent_commit_sha256: nullable(hash),
  },
  exact,
);
const token = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const usage = Type.Union([
  Type.Object(
    {
      input_tokens: token,
      output_tokens: token,
      cost_usd: Type.Number({ minimum: 0 }),
      cost_status: Type.Literal("known"),
    },
    exact,
  ),
  Type.Object(
    {
      input_tokens: token,
      output_tokens: token,
      cost_usd: Type.Null(),
      cost_status: Type.Literal("unknown"),
    },
    exact,
  ),
]);
export const UsageSchema = usage;
export type UsageSchemaValue = Static<typeof UsageSchema>;
const usageTotalFields = {
  known_cost_usd: nullable(Type.Number({ minimum: 0 })),
  token_status: Type.Union([
    Type.Literal("known"),
    Type.Literal("partial"),
    Type.Literal("unknown"),
  ]),
  invocation_count: token,
  unknown_invocations: token,
  unresolved_invocations: token,
  attribution_complete: Type.Boolean(),
  unattributed_invocations: token,
};
export const UsageTotalsSchema = Type.Union([
  Type.Object(
    { ...UsageSchema.anyOf[0].properties, ...usageTotalFields },
    exact,
  ),
  Type.Object(
    { ...UsageSchema.anyOf[1].properties, ...usageTotalFields },
    exact,
  ),
]);
export type UsageTotalsSchemaValue = Static<typeof UsageTotalsSchema>;
export const InvocationSchema = Type.Object(
  {
    request_started: Type.Optional(Type.Boolean()),
    schema_version: Type.Literal(1),
    invocation_id: identity,
    execution_scope: scope,
    subject_id: Type.String(),
    capability: Type.String(),
    input_hash: hash,
    context_hash: hash,
    policy_hash: hash,
    model: Type.String(),
    sdk_version: Type.String(),
    status: Type.Union(
      ["prepared", "running", "succeeded", "failed", "unknown"].map((v) =>
        Type.Literal(v),
      ),
    ),
    messages: Type.Array(
      Type.Object(
        {
          message_id: Type.String({ minLength: 1 }),
          usage,
          summary: Type.Boolean(),
        },
        exact,
      ),
    ),
    usage,
    limits: Type.Unknown(),
  },
  exact,
);
export const StorageSchema = Type.Object(
  {
    verified: Type.Boolean(),
    observed_at: UtcInstantSchema,
    occupied_bytes: Type.Integer({ minimum: 0 }),
    reserved_bytes: Type.Integer({ minimum: 0 }),
    limit_bytes: Type.Integer({ minimum: 0 }),
    warning: Type.Boolean(),
    accepts_generation: Type.Boolean(),
  },
  exact,
);
export const StorageReservationSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    reservation_id: identity,
    execution_scope: scope,
    bucket: Type.String({ minLength: 1, pattern: "^[^\\u0000-\\u001f]+$" }),
    key: Type.String({ minLength: 1, pattern: "^[^\\u0000-\\u001f]+$" }),
    version: nullable(Type.String({ minLength: 1 })),
    expected_bytes: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("confirmed"),
      Type.Literal("released"),
    ]),
  },
  exact,
);
export const ArtifactSealSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    execution_scope: scope,
    workspace_id: Type.String({ minLength: 1 }),
    project_id: identity,
    workspace_revision: identity,
    files: Type.Array(ManifestFileSchema, { minItems: 1 }),
    validated_hash: hash,
    publish_checks: Type.Union([
      Type.Literal("passed"),
      Type.Literal("not_exercised"),
    ]),
    resources: Type.Unknown(),
  },
  exact,
);
const validators = new Map<string, ReturnType<typeof TypeCompiler.Compile>>();
export function registerSchema(name: string, schema: TSchema): void {
  if (validators.has(name))
    throw new AgentError("configuration", "Schema registered twice");
  validators.set(name, TypeCompiler.Compile(schema));
}
/** The same table drives runtime registration, generated documents and drift tests. */
export const SHARED_SCHEMA_DOCUMENTS = [
  { name: "workspace", file: "workspace.schema.json", schema: WorkspaceSchema },
  {
    name: "manifest_file",
    file: "manifest-file.schema.json",
    schema: ManifestFileSchema,
  },
  {
    name: "checkpoint",
    file: "checkpoint.schema.json",
    schema: CheckpointSchema,
  },
  {
    name: "invocation",
    file: "invocation.schema.json",
    schema: InvocationSchema,
  },
  { name: "usage", file: "usage.schema.json", schema: UsageSchema },
  {
    name: "usage_totals",
    file: "usage-totals.schema.json",
    schema: UsageTotalsSchema,
  },
  { name: "storage", file: "storage.schema.json", schema: StorageSchema },
  {
    name: "storage_reservation",
    file: "storage-reservation.schema.json",
    schema: StorageReservationSchema,
  },
  {
    name: "artifact_seal",
    file: "artifact-seal.schema.json",
    schema: ArtifactSealSchema,
  },
  {
    name: "utc_instant",
    file: "utc-instant.schema.json",
    schema: UtcInstantSchema,
  },
] as const;
for (const entry of SHARED_SCHEMA_DOCUMENTS)
  registerSchema(entry.name, entry.schema);
export function validateSchema<T>(name: string, value: unknown): T {
  const v = validators.get(name);
  if (!v) throw new AgentError("configuration", "Unknown schema");
  if (!v.Check(value))
    throw new AgentError(
      "corrupt",
      `Invalid ${name} schema: ${[...v.Errors(value)].map((e) => e.path).join(",")}`,
    );
  if (name === "invocation") {
    const invocation = value as InvocationRecord;
    canonicalJson(invocation.limits);
    if (invocation.request_started === false) {
      const message = invocation.messages[0];
      if (
        invocation.messages.length !== 1 ||
        !message?.summary ||
        message.message_id !== `not_started_${invocation.invocation_id}` ||
        message.usage.cost_status !== "known" ||
        message.usage.cost_usd !== 0 ||
        message.usage.input_tokens !== 0 ||
        message.usage.output_tokens !== 0 ||
        !["running", "failed"].includes(invocation.status)
      )
        throw new AgentError("corrupt", "Invocation not-started proof invalid");
    }
  }
  return value as T;
}
export type WorkspaceSchemaValue = Static<typeof WorkspaceSchema>;

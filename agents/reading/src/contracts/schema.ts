import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { AgentError } from "./index.js";
const identity = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-zA-Z0-9_-]+$",
});
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const scope = Type.Union([Type.Literal("production"), Type.Literal("preview")]);
const nullable = (s: TSchema) => Type.Union([s, Type.Null()]);
const exact = { additionalProperties: false };
export const ManifestFileSchema = Type.Object(
  {
    path: Type.String(),
    sha256: hash,
    size: Type.Integer({ minimum: 0, maximum: 33554432 }),
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
    created_at: Type.String(),
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
const usage = Type.Object(
  {
    input_tokens: Type.Integer({ minimum: 0 }),
    output_tokens: Type.Integer({ minimum: 0 }),
    cost_usd: nullable(Type.Number({ minimum: 0 })),
    cost_status: Type.Union([Type.Literal("known"), Type.Literal("unknown")]),
  },
  exact,
);
export const InvocationSchema = Type.Object(
  {
    request_started: Type.Optional(Type.Boolean()),
    schema_version: Type.Literal(1),
    invocation_id: Type.String(),
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
        { message_id: Type.String(), usage, summary: Type.Boolean() },
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
    observed_at: Type.String(),
    occupied_bytes: Type.Integer({ minimum: 0 }),
    reserved_bytes: Type.Integer({ minimum: 0 }),
    limit_bytes: Type.Integer({ minimum: 0 }),
    warning: Type.Boolean(),
    accepts_generation: Type.Boolean(),
  },
  exact,
);
const validators = new Map<string, ReturnType<typeof TypeCompiler.Compile>>();
export function registerSchema(name: string, schema: TSchema): void {
  if (validators.has(name))
    throw new AgentError("configuration", "Schema registered twice");
  validators.set(name, TypeCompiler.Compile(schema));
}
registerSchema("workspace", WorkspaceSchema);
registerSchema("checkpoint", CheckpointSchema);
registerSchema("invocation", InvocationSchema);
registerSchema("storage", StorageSchema);
export function validateSchema<T>(name: string, value: unknown): T {
  const v = validators.get(name);
  if (!v) throw new AgentError("configuration", "Unknown schema");
  if (!v.Check(value))
    throw new AgentError(
      "corrupt",
      `Invalid ${name} schema: ${[...v.Errors(value)].map((e) => e.path).join(",")}`,
    );
  return value as T;
}
export type WorkspaceSchemaValue = Static<typeof WorkspaceSchema>;

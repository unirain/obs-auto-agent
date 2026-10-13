import { Type } from "@sinclair/typebox";
import { UtcInstantSchema } from "../contracts/utc.js";
const exact = { additionalProperties: false };
const text = Type.String();
const nullableText = Type.Union([text, Type.Null()]);
const enumStrings = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((v) => Type.Literal(v)));
const workspace = Type.Object(
  {
    bucket: text,
    region: text,
    endpoint: text,
    prefix: text,
    credential_ref: text,
    versioning_verified: enumStrings(["never_enabled", "unknown"]),
    private_verified: Type.Boolean(),
    lifecycle_verified: Type.Boolean(),
  },
  exact,
);
const image = Type.Object(
  {
    bucket: text,
    region: text,
    endpoint: text,
    prefix: text,
    public_url: text,
    credential_ref: text,
    sole_writer_verified: Type.Boolean(),
    versioning: enumStrings(["disabled", "enabled", "suspended", "unknown"]),
  },
  exact,
);
const fields = {
  schema_version: Type.Literal(1),
  name: enumStrings(["production", "preview", "integration"]),
  execution_scope: enumStrings(["production", "preview"]),
  workspace_id: text,
  workspace,
  image: Type.Union([image, Type.Null()]),
  target_repository: nullableText,
  github_app_credential_ref: nullableText,
  implementation_repository: text,
  watchdog_credential_ref: nullableText,
  watchdog_repository: Type.Optional(nullableText),
  model_credential_ref: text,
  model: text,
  cost_policy: Type.Literal("observe_only"),
  storage_limit_bytes: Type.Literal(50_000_000_000),
  cron_enabled: Type.Boolean(),
  enabled_at: Type.Union([UtcInstantSchema, Type.Null()]),
  g5_evidence: Type.Union([
    Type.String({ pattern: "^[a-f0-9]{64}$" }),
    Type.Null(),
  ]),
};
/** Structural deployment DTO. parseDeployment additionally enforces trusted target/scope and activation rules. */
export const DeploymentSchema = Type.Union([
  Type.Object(
    {
      ...fields,
      model_provider: Type.Optional(Type.Literal("claude")),
      model_base_url: Type.Optional(Type.Literal("https://api.anthropic.com")),
    },
    exact,
  ),
  Type.Object(
    {
      ...fields,
      model_provider: Type.Literal("deepseek"),
      model_base_url: Type.Literal("https://api.deepseek.com/anthropic"),
    },
    exact,
  ),
]);
export const CONFIG_SCHEMA_DOCUMENTS = [
  {
    name: "deployment",
    file: "deployment.schema.json",
    schema: DeploymentSchema,
  },
];

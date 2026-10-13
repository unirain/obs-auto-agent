import { Type, type TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { UtcInstantSchema, assertUtcInstant } from "../contracts/utc.js";
import type {
  DeliveryRecord,
  ResourceReceipt,
  PullRequestFact,
} from "./types.js";
import type { HumanReviewFeedback } from "./metrics.js";
const exact = { additionalProperties: false };
const text = Type.String();
const sha = Type.String({ pattern: "^[a-f0-9]{64}$" });
const gitsha = Type.String({ pattern: "^[a-f0-9]{40}$" });
const nullable = (schema: TSchema) => Type.Union([schema, Type.Null()]);
const strings = Type.Array(text);
const enumeration = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((v) => Type.Literal(v)));
export const ResourceReceiptSchema = Type.Object(
  {
    object_key: text,
    sha256: sha,
    bytes: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    mime: enumeration([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml",
    ]),
    url: Type.String({ pattern: "^https://" }),
    project_id: text,
    version_id: nullable(text),
    confirmed_at: UtcInstantSchema,
  },
  exact,
);
export const StoredDeliverySchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    delivery_id: text,
    execution_scope: Type.Literal("production"),
    workspace_id: text,
    project_id: text,
    generation_version: Type.Integer({
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    workspace_revision: Type.String({ minLength: 1 }),
    context_id: text,
    base_commit: gitsha,
    sources_verified_at: UtcInstantSchema,
    files: Type.Array(
      Type.Object(
        {
          path: text,
          role: enumeration(["note", "diagram_source"]),
          mime: text,
          bytes: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          sha256: sha,
          content_base64: text,
          symlink: Type.Optional(Type.Literal(false)),
        },
        exact,
      ),
    ),
    resources: Type.Array(ResourceReceiptSchema),
    sources: strings,
    primary_source_aliases: Type.Optional(strings),
    quality_report: Type.Record(text, Type.Unknown()),
    rationale: text,
    knowledge_increment: text,
    gaps: strings,
    image_degradations: strings,
    usage: Type.Object(
      {
        status: enumeration(["known", "unknown", "partial"]),
        estimated_usd: nullable(Type.Number({ minimum: 0 })),
      },
      exact,
    ),
    warnings: strings,
    validated_hash: sha,
  },
  exact,
);
export const PullRequestFactSchema = Type.Object(
  {
    number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    url: text,
    state: enumeration(["open", "closed_unmerged", "merged"]),
    branch: text,
    head_sha: gitsha,
    delivery_id: nullable(text),
    created_at: Type.Optional(UtcInstantSchema),
    closed_at: Type.Optional(nullable(UtcInstantSchema)),
    merged_at: Type.Optional(nullable(UtcInstantSchema)),
  },
  exact,
);
export const GitIdentitySchema = Type.Object(
  { name: text, email: text, date: UtcInstantSchema },
  exact,
);
export const PreparedCommitSchema = Type.Object(
  {
    base_commit: gitsha,
    base_tree: gitsha,
    tree_sha: gitsha,
    commit_sha: gitsha,
    message: text,
    identity: GitIdentitySchema,
    blobs: Type.Array(
      Type.Object({ path: text, sha: gitsha, content_base64: text }, exact),
    ),
    files: Type.Array(Type.Object({ path: text, sha256: sha }, exact)),
  },
  exact,
);
export const PolicyEvidenceSchema = Type.Object(
  {
    check_id: sha,
    policy_commit: nullable(gitsha),
    policy_hash: nullable(sha),
    checked_at: UtcInstantSchema,
    execution_permission: Type.Optional(
      enumeration(["allowed", "denied", "unavailable"]),
    ),
  },
  exact,
);
export const WritePolicyReceiptSchema = Type.Object(
  {
    action: text,
    evidence: nullable(PolicyEvidenceSchema),
    status: enumeration(["verified", "legacy_unverified"]),
    checked_at: UtcInstantSchema,
  },
  exact,
);
export const DeliveryRecordSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    delivery_id: text,
    project_id: text,
    generation_version: Type.Integer({
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    branch: text,
    status: enumeration([
      "publishing",
      "awaiting_review",
      "closed_unmerged",
      "merged",
      "delivery_conflict",
      "needs_resume",
      "policy_blocked",
      "superseded",
    ]),
    prepared: nullable(PreparedCommitSchema),
    pr: nullable(PullRequestFactSchema),
    uncertain_action: nullable(text),
    reason: nullable(text),
    policy_checks: Type.Optional(Type.Array(WritePolicyReceiptSchema)),
    updated_at: UtcInstantSchema,
    superseded_by: Type.Optional(text),
    review_outcome: Type.Optional(
      enumeration([
        "accepted_without_changes",
        "accepted_with_changes",
        "rejected",
        "pending",
      ]),
    ),
    merged_notes: Type.Optional(
      Type.Array(
        Type.Object({ path: text, content: text, sha: gitsha }, exact),
      ),
    ),
  },
  exact,
);
export const HumanReviewFeedbackSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    delivery_id: text,
    actor: text,
    recorded_at: UtcInstantSchema,
    reason: nullable(
      enumeration([
        "topic_irrelevant",
        "duplicate",
        "too_shallow",
        "incorrect_fact",
        "missing_source",
        "image_or_text_quality",
        "more_like_this",
      ]),
    ),
    review_minutes: nullable(Type.Number({ minimum: 0 })),
    origin: Type.Literal("trusted_management"),
    pr_binding: Type.Optional(
      Type.Object(
        {
          repository: text,
          number: Type.Integer({
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          }),
          url: text,
          head_sha: gitsha,
          state: enumeration(["open", "merged", "closed_unmerged"]),
          checked_at: UtcInstantSchema,
        },
        exact,
      ),
    ),
  },
  exact,
);
const resource = TypeCompiler.Compile(ResourceReceiptSchema);
const delivery = TypeCompiler.Compile(DeliveryRecordSchema);
const feedback = TypeCompiler.Compile(HumanReviewFeedbackSchema);
const stored = TypeCompiler.Compile(StoredDeliverySchema);
const pr = TypeCompiler.Compile(PullRequestFactSchema);
const policyReceipt = TypeCompiler.Compile(WritePolicyReceiptSchema);
export const PUBLISH_SCHEMA_DOCUMENTS = [
  {
    name: "resource-receipt",
    file: "resource-receipt.schema.json",
    schema: ResourceReceiptSchema,
  },
  {
    name: "delivery",
    file: "delivery.schema.json",
    schema: StoredDeliverySchema,
  },
  {
    name: "delivery-record",
    file: "delivery-record.schema.json",
    schema: DeliveryRecordSchema,
  },
  {
    name: "human-review-feedback",
    file: "human-review-feedback.schema.json",
    schema: HumanReviewFeedbackSchema,
  },
];
export function parseResourceReceipt(value: unknown): ResourceReceipt {
  if (!resource.Check(value))
    throw new Error("Invalid resource receipt schema/UTC");
  return value as ResourceReceipt;
}
export function parseDeliveryRecord(value: unknown): DeliveryRecord {
  if (!delivery.Check(value))
    throw new Error("Invalid delivery record schema/UTC");
  return value as DeliveryRecord;
}
export function parseHumanReviewFeedback(value: unknown): HumanReviewFeedback {
  if (!feedback.Check(value))
    throw new Error("Invalid human review feedback schema/UTC");
  return value as HumanReviewFeedback;
}
export function parseStoredDelivery(value: unknown): void {
  if (!stored.Check(value))
    throw new Error("Invalid stored delivery schema/UTC");
}
export function parsePullRequestFact(value: unknown): PullRequestFact {
  if (!pr.Check(value)) throw new Error("Invalid remote PR fact schema/UTC");
  return value as PullRequestFact;
}
export function assertWritePolicyReceipt(value: unknown): void {
  if (!policyReceipt.Check(value))
    throw new Error("Invalid write policy receipt schema/UTC");
}
export function assertGitHubFactTimes(value: {
  observation?: { checked_at: string };
  prs: PullRequestFact[];
}): void {
  if (value.observation)
    assertUtcInstant(
      value.observation.checked_at,
      "GitHub observation checked_at",
    );
  value.prs.forEach(parsePullRequestFact);
}

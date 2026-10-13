import { createHash } from "node:crypto";
export type ExecutionScope = "production" | "preview";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type ErrorCode =
  | "not_found"
  | "conflict"
  | "permission"
  | "configuration"
  | "corrupt"
  | "transient"
  | "unknown"
  | "capacity"
  | "scope";
export class AgentError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
export const SCHEMA_VERSION = 1;
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new AgentError("corrupt", "Nonfinite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    return (
      "{" +
      Object.keys(value as object)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonicalJson((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  }
  throw new AgentError("corrupt", "Not JSON");
}
export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export interface ObjectMetadata {
  key: string;
  size: number;
  created_at: string;
  version?: string;
}
export interface ObjectPage {
  objects: ObjectMetadata[];
  next_cursor: string | null;
}
export interface BucketConfiguration {
  versioning: "never" | "enabled" | "suspended";
  acl: "private" | "public-read" | "public-read-write";
  endpoint: string;
  lifecycle: { prefix: string; expires: boolean }[];
  anonymous_readable: boolean;
}
export interface ObjectStore {
  readonly bucket: string;
  create(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  stat(key: string): Promise<ObjectMetadata>;
  list(prefix: string, cursor?: string): Promise<ObjectPage>;
  delete(key: string): Promise<void>;
  configuration(): Promise<BucketConfiguration>;
}
export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
  role: "control" | "input" | "evidence" | "artifact" | "output" | "report";
  project_id: string | null;
}
export interface WorkspaceManifest {
  schema_version: 1;
  workspace_id: string;
  execution_scope: ExecutionScope;
  revision: string;
  parent_revision: string | null;
  run_id: string;
  checkpoint_reason: string;
  created_at: string;
  files: ManifestFile[];
}
export interface CommitRecord {
  schema_version: 1;
  sequence: string;
  workspace_id: string;
  execution_scope: ExecutionScope;
  revision: string;
  manifest_key: string;
  manifest_sha256: string;
  parent_commit_key: string | null;
  parent_commit_sha256: string | null;
}
export interface CommittedSnapshot {
  workspace_id: string;
  execution_scope: ExecutionScope;
  revision: string;
  sequence: string;
  commit_key: string;
  commit_sha256: string;
  manifest_key: string;
  manifest_sha256: string;
  manifest: WorkspaceManifest;
}
export interface StorageCapacityView {
  verified: boolean;
  observed_at: string;
  occupied_bytes: number;
  reserved_bytes: number;
  limit_bytes: number;
  warning: boolean;
  accepts_generation: boolean;
}
export interface WorkspaceHandle {
  readonly workspace_id: string;
  readonly execution_scope: ExecutionScope;
  readonly revision: string;
  readonly root_dir: string;
  readonly snapshot: CommittedSnapshot;
  readonly records: Readonly<Record<string, JsonValue>>;
  readonly capacity?: StorageCapacityView;
}
export interface CheckpointFile {
  path: string;
  bytes: Uint8Array;
  role: ManifestFile["role"];
  project_id?: string | null;
}
export interface CheckpointChange {
  /** Trusted host only; new data roles and admission events always override to generation. */
  write_kind?: "control" | "generation";
  expected_revision: string;
  reason: string;
  run_id: string;
  event?: { type: string; subject_id?: string; from?: string; to?: string };
  records?: Record<string, JsonValue | null>;
  files?: CheckpointFile[];
  remove_paths?: string[];
}
export type CheckpointResult =
  | {
      status: "committed";
      handle: WorkspaceHandle;
      snapshot: CommittedSnapshot;
    }
  | { status: "conflict"; reason: string }
  | { status: "unknown"; reason: string; commit_key: string };
export interface WorkspaceManager {
  restore(
    workspaceId: string,
    options?: { allow_initialize?: boolean; run_id?: string },
  ): Promise<WorkspaceHandle>;
  checkpoint(
    handle: WorkspaceHandle,
    change: CheckpointChange,
  ): Promise<CheckpointResult>;
}
export interface InvocationRecord {
  /** Only trusted host can prove that no SDK query started. */
  request_started?: boolean;
  schema_version: 1;
  invocation_id: string;
  execution_scope: ExecutionScope;
  subject_id: string;
  capability: string;
  input_hash: string;
  context_hash: string;
  policy_hash: string;
  model: string;
  sdk_version: string;
  status: "prepared" | "running" | "succeeded" | "failed" | "unknown";
  messages: InvocationMessage[];
  usage: Usage;
  limits: JsonValue;
}
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_status: "known" | "unknown";
}
export interface InvocationMessage {
  message_id: string;
  usage: Usage;
  summary: boolean;
}
export interface InvocationJournal {
  prepare(
    handle: WorkspaceHandle,
    record: InvocationRecord,
    runId: string,
  ): Promise<CheckpointResult>;
  observe(
    handle: WorkspaceHandle,
    id: string,
    message: InvocationMessage,
    runId: string,
  ): Promise<CheckpointResult>;
  finish(
    handle: WorkspaceHandle,
    id: string,
    status: "succeeded" | "failed" | "unknown",
    runId: string,
  ): Promise<CheckpointResult>;
}

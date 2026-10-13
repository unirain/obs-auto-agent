import { createHash } from "node:crypto";
import type { Dispatch } from "./dispatch.js";
export interface OSSBinding {
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
  credential_ref: string;
  versioning_verified: "never_enabled" | "unknown";
  private_verified: boolean;
  lifecycle_verified: boolean;
}
export interface ImageBinding {
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
  public_url: string;
  credential_ref: string;
  sole_writer_verified: boolean;
  versioning: "disabled" | "enabled" | "suspended" | "unknown";
}
export interface Deployment {
  schema_version: 1;
  name: "production" | "preview" | "integration";
  execution_scope: "production" | "preview";
  workspace_id: string;
  workspace: OSSBinding;
  image: ImageBinding | null;
  target_repository: string | null;
  github_app_credential_ref: string | null;
  implementation_repository: string;
  watchdog_repository?: string | null;
  watchdog_credential_ref: string | null;
  model_credential_ref: string;
  model: string;
  model_provider?: "claude" | "deepseek";
  model_base_url?: string;
  cost_policy: "observe_only";
  storage_limit_bytes: 50000000000;
  cron_enabled: boolean;
  enabled_at: string | null;
  g5_evidence: string | null;
}
export interface ExecutionTarget {
  deployment: Deployment;
  dispatch: Dispatch;
  workspace_id: string;
  execution_scope: "production" | "preview";
  config_hash: string;
}
const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const ref = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(v);
function endpoint(endpoint: unknown, region: unknown): void {
  if (
    typeof endpoint !== "string" ||
    typeof region !== "string" ||
    !/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(endpoint) ||
    endpoint.includes("-internal.") ||
    endpoint !== `${region}.aliyuncs.com`
  )
    throw new Error("Only matching OSS public endpoint is allowed");
}
function prefix(p: unknown): void {
  if (
    typeof p !== "string" ||
    !p.endsWith("/") ||
    p.startsWith("/") ||
    p
      .split("/")
      .slice(0, -1)
      .some((x) => !x || x === ".." || x === ".") ||
    p.includes("\\")
  )
    throw new Error("Unsafe OSS prefix");
}
export function parseDeployment(value: unknown): Deployment {
  if (
    !plain(value) ||
    value.schema_version !== 1 ||
    !["production", "preview", "integration"].includes(String(value.name)) ||
    !["production", "preview"].includes(String(value.execution_scope))
  )
    throw new Error("Invalid deployment envelope");
  const d = value as unknown as Deployment;
  if (
    !plain(d.workspace) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(d.workspace.bucket) ||
    !ref(d.workspace.credential_ref)
  )
    throw new Error("Invalid workspace binding");
  endpoint(d.workspace.endpoint, d.workspace.region);
  prefix(d.workspace.prefix);
  if (
    Object.keys(d.workspace).some(
      (k) =>
        ![
          "bucket",
          "region",
          "endpoint",
          "prefix",
          "credential_ref",
          "versioning_verified",
          "private_verified",
          "lifecycle_verified",
        ].includes(k),
    )
  )
    throw new Error("Unexpected workspace field");
  if (
    !["never_enabled", "unknown"].includes(d.workspace.versioning_verified) ||
    typeof d.workspace.private_verified !== "boolean" ||
    typeof d.workspace.lifecycle_verified !== "boolean"
  )
    throw new Error("Missing OSS verification state");
  const provider = d.model_provider ?? "claude";
  if (!["claude", "deepseek"].includes(provider))
    throw new Error("Unsupported model provider");
  const allowedBase =
    provider === "deepseek"
      ? "https://api.deepseek.com/anthropic"
      : "https://api.anthropic.com";
  if (
    (provider === "deepseek" && d.model_base_url !== allowedBase) ||
    (d.model_base_url !== undefined && d.model_base_url !== allowedBase)
  )
    throw new Error("Untrusted model credential endpoint");
  if (
    d.cost_policy !== "observe_only" ||
    d.storage_limit_bytes !== 50_000_000_000 ||
    !ref(d.model_credential_ref) ||
    typeof d.model !== "string" ||
    !d.model ||
    !/^[\w.-]+\/[\w.-]+$/.test(d.implementation_repository)
  )
    throw new Error("Invalid runtime/account binding");
  if (d.watchdog_credential_ref !== null && !ref(d.watchdog_credential_ref))
    throw new Error("Invalid watchdog credential reference");
  if (
    d.watchdog_repository !== undefined &&
    d.watchdog_repository !== null &&
    !/^[\w.-]+\/[\w.-]+$/.test(d.watchdog_repository)
  )
    throw new Error("Invalid watchdog repository binding");
  if (d.name === "preview") {
    if (
      d.execution_scope !== "preview" ||
      d.workspace_id !== "obs-notes-hub/reading-preview" ||
      !d.workspace.prefix.includes("preview/") ||
      d.image !== null ||
      d.target_repository !== null ||
      d.github_app_credential_ref !== null ||
      d.watchdog_credential_ref !== null ||
      d.watchdog_repository != null ||
      d.cron_enabled
    )
      throw new Error("Preview cannot load production write capabilities");
  } else {
    if (
      d.execution_scope !== "production" ||
      !d.target_repository ||
      !/^[\w.-]+\/[\w.-]+$/.test(d.target_repository) ||
      !ref(d.github_app_credential_ref)
    )
      throw new Error("Missing production publication binding");
    if (
      d.name === "production" &&
      (d.workspace_id !== "obs-notes-hub/reading" ||
        d.target_repository !== "unirain/obs-notes-hub" ||
        !d.workspace.prefix.includes("production/"))
    )
      throw new Error("Production target mismatch");
    if (
      d.name === "integration" &&
      (d.workspace_id !== "obs-notes-hub/reading-integration" ||
        d.target_repository === "unirain/obs-notes-hub" ||
        !d.workspace.prefix.includes("integration/") ||
        !d.image?.prefix.includes("integration/") ||
        d.cron_enabled)
    )
      throw new Error("Integration requires isolated production-scope targets");
    if (
      !plain(d.image) ||
      typeof d.image.bucket !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(d.image.bucket) ||
      typeof d.image.public_url !== "string" ||
      !ref(d.image.credential_ref) ||
      typeof d.image.sole_writer_verified !== "boolean" ||
      !["disabled", "enabled", "suspended", "unknown"].includes(
        d.image.versioning,
      )
    )
      throw new Error("Missing image binding");
    endpoint(d.image.endpoint, d.image.region);
    prefix(d.image.prefix);
    if (
      Object.keys(d.image).some(
        (k) =>
          ![
            "bucket",
            "region",
            "endpoint",
            "prefix",
            "public_url",
            "credential_ref",
            "sole_writer_verified",
            "versioning",
          ].includes(k),
      )
    )
      throw new Error("Unexpected image field");
    const publicURL = new URL(d.image.public_url);
    if (
      publicURL.protocol !== "https:" ||
      publicURL.username ||
      publicURL.password ||
      publicURL.search ||
      publicURL.hash
    )
      throw new Error("Invalid image public URL");
    if (
      d.image.bucket === d.workspace.bucket &&
      (d.image.prefix.startsWith(d.workspace.prefix) ||
        d.workspace.prefix.startsWith(d.image.prefix))
    )
      throw new Error("Image/workspace prefix overlap");
  }
  if (
    typeof d.cron_enabled !== "boolean" ||
    (d.enabled_at !== null &&
      (typeof d.enabled_at !== "string" ||
        !Number.isFinite(Date.parse(d.enabled_at)))) ||
    (d.g5_evidence !== null && !/^[a-f0-9]{64}$/.test(d.g5_evidence))
  )
    throw new Error("Invalid activation state");
  if (
    d.cron_enabled &&
    (d.name !== "production" || !d.enabled_at || !d.g5_evidence)
  )
    throw new Error("Cron requires recorded G5 evidence");
  // Exact top-level fields prevent accidentally storing raw secret configuration in audit snapshots.
  const allowed = new Set([
    "schema_version",
    "name",
    "execution_scope",
    "workspace_id",
    "workspace",
    "image",
    "target_repository",
    "github_app_credential_ref",
    "implementation_repository",
    "watchdog_repository",
    "watchdog_credential_ref",
    "model_credential_ref",
    "model",
    "model_provider",
    "model_base_url",
    "cost_policy",
    "storage_limit_bytes",
    "cron_enabled",
    "enabled_at",
    "g5_evidence",
  ]);
  if (Object.keys(value).some((k) => !allowed.has(k)))
    throw new Error("Unexpected deployment field");
  return structuredClone(d);
}
export function executionTarget(
  d: Deployment,
  dispatch: Dispatch,
): ExecutionTarget {
  parseDeployment(d);
  if ((dispatch.mode === "preview") !== (d.name === "preview"))
    throw new Error("Mode/deployment scope mismatch");
  const workspace_id =
    dispatch.mode === "preview"
      ? `${d.workspace_id}/${dispatch.preview_id ?? "new"}`
      : d.workspace_id;
  return {
    deployment: d,
    dispatch,
    workspace_id,
    execution_scope: d.execution_scope,
    config_hash: createHash("sha256").update(JSON.stringify(d)).digest("hex"),
  };
}
export function assertWorkspaceReady(d: Deployment): void {
  if (
    d.workspace.versioning_verified !== "never_enabled" ||
    !d.workspace.private_verified ||
    !d.workspace.lifecycle_verified
  )
    throw new Error("Live OSS prerequisites remain unverified");
}
/** Host-only secret injection; this object is never passed to model tools. */
export function credentialReferences(
  target: ExecutionTarget,
  role: "workspace" | "publisher" | "image" | "model" | "watchdog",
): string[] {
  const d = target.deployment;
  if (role === "workspace") return [d.workspace.credential_ref];
  if (role === "model") return [d.model_credential_ref];
  if (d.execution_scope === "preview")
    throw new Error("Preview has no publication/Issue credential capability");
  const selected =
    role === "publisher"
      ? d.github_app_credential_ref
      : role === "image"
        ? d.image?.credential_ref
        : d.watchdog_credential_ref;
  if (!selected) throw new Error("Missing host credential reference");
  return [selected];
}

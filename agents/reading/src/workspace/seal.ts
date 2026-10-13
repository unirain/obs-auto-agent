import { readFile } from "node:fs/promises";
import {
  AgentError,
  sha256,
  canonicalJson,
  type WorkspaceHandle,
  type JsonValue,
  type ManifestFile,
} from "../contracts/index.js";
import { safeLocalPath } from "./paths.js";
import { validateSchema } from "../contracts/schema.js";
import { validateManifestFile } from "./manifest.js";
export interface SealCheck {
  review_passed: boolean;
  program_checks_passed: boolean;
  input_revision: string;
  resources: JsonValue;
}
export interface ArtifactSeal {
  schema_version: 1;
  execution_scope: "production" | "preview";
  workspace_id: string;
  project_id: string;
  workspace_revision: string;
  files: ManifestFile[];
  validated_hash: string;
  publish_checks: "passed" | "not_exercised";
  resources: JsonValue;
}
async function seal(
  handle: WorkspaceHandle,
  projectId: string,
  check: SealCheck,
  production: boolean,
): Promise<ArtifactSeal | null> {
  if (production && handle.execution_scope !== "production")
    throw new AgentError("scope", "Preview cannot seal delivery");
  if (!check.review_passed || !check.program_checks_passed) return null;
  if (check.input_revision !== handle.revision)
    throw new AgentError(
      "conflict",
      "Review is bound to a different committed version",
    );
  const files = handle.snapshot.manifest.files.filter(
    (f) =>
      f.project_id === projectId && ["artifact", "output"].includes(f.role),
  );
  if (!files.length)
    throw new AgentError("corrupt", "No committed artifacts to seal");
  for (const file of files) {
    const actual = await readFile(
      await safeLocalPath(handle.root_dir, file.path),
    );
    if (actual.length !== file.size || sha256(actual) !== file.sha256)
      throw new AgentError(
        "corrupt",
        "Sealed artifact changed after checkpoint",
      );
  }
  const body = {
    schema_version: 1 as const,
    execution_scope: handle.execution_scope,
    workspace_id: handle.workspace_id,
    project_id: projectId,
    workspace_revision: handle.revision,
    files,
    publish_checks: production
      ? ("passed" as const)
      : ("not_exercised" as const),
    resources: check.resources,
  };
  return { ...body, validated_hash: sha256(canonicalJson(body)) };
}
export async function sealDelivery(
  handle: WorkspaceHandle,
  projectId: string,
  check: SealCheck,
): Promise<ArtifactSeal> {
  const result = await seal(handle, projectId, check, true);
  if (!result)
    throw new AgentError("corrupt", "Review or program validation failed");
  return result;
}
export function sealPreviewIfReviewPassed(
  handle: WorkspaceHandle,
  projectId: string,
  check: SealCheck,
): Promise<ArtifactSeal | null> {
  if (handle.execution_scope !== "preview")
    throw new AgentError("scope", "Expected preview scope");
  return seal(handle, projectId, check, false);
}
export async function verifySeal(
  handle: WorkspaceHandle,
  value: ArtifactSeal,
): Promise<void> {
  validateSchema("artifact_seal", value);
  if (
    value.execution_scope !== handle.execution_scope ||
    value.workspace_id !== handle.workspace_id ||
    value.workspace_revision !== handle.revision
  )
    throw new AgentError("scope", "Seal scope or revision mismatch");
  const { validated_hash, ...body } = value;
  if (sha256(canonicalJson(body)) !== validated_hash)
    throw new AgentError("corrupt", "Seal hash changed");
  const expectedFiles = handle.snapshot.manifest.files.filter(
    (f) =>
      f.project_id === value.project_id &&
      ["artifact", "output"].includes(f.role),
  );
  if (
    canonicalJson(expectedFiles) !== canonicalJson(value.files) ||
    value.publish_checks !==
      (handle.execution_scope === "production" ? "passed" : "not_exercised")
  )
    throw new AgentError(
      "corrupt",
      "Seal does not include the complete reviewed artifact set",
    );
  for (const file of value.files) {
    validateManifestFile(file);
    const committed = handle.snapshot.manifest.files.find(
      (f) => f.path === file.path,
    );
    if (!committed || canonicalJson(committed) !== canonicalJson(file))
      throw new AgentError("corrupt", "Seal references uncommitted file");
    const bytes = await readFile(
      await safeLocalPath(handle.root_dir, file.path),
    );
    if (sha256(bytes) !== file.sha256)
      throw new AgentError("corrupt", "Seal file changed");
  }
}

import {
  AgentError,
  canonicalJson,
  sha256,
  type WorkspaceManifest,
  type CommitRecord,
} from "../contracts/index.js";
import { validateSchema } from "../contracts/schema.js";
import { validatePath, MAX_FILE_BYTES } from "./paths.js";
export function encode(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value));
}
export function decode<T>(bytes: Uint8Array, schema: string): T {
  try {
    return validateSchema<T>(
      schema,
      JSON.parse(Buffer.from(bytes).toString("utf8")),
    );
  } catch (e) {
    if (e instanceof AgentError) throw e;
    throw new AgentError("corrupt", "Invalid JSON document");
  }
}
export function validateManifest(value: WorkspaceManifest): void {
  validateSchema("workspace", value);
  if (!Number.isFinite(Date.parse(value.created_at)))
    throw new AgentError("corrupt", "Invalid manifest timestamp");
  const paths = new Set<string>();
  for (const f of value.files) {
    validatePath(f.path);
    if (paths.has(f.path) || f.size > MAX_FILE_BYTES)
      throw new AgentError("corrupt", "Duplicate or oversized manifest file");
    paths.add(f.path);
    if (
      f.project_id !== null &&
      !f.path.startsWith(`projects/${f.project_id}/`) &&
      !f.path.startsWith("outputs/")
    )
      throw new AgentError("scope", "Project association mismatch");
  }
}
export function assertBytes(
  bytes: Uint8Array,
  hash: string,
  size?: number,
): void {
  if (sha256(bytes) !== hash || (size !== undefined && bytes.length !== size))
    throw new AgentError("corrupt", "Object hash or size mismatch");
}
export function validateCommit(value: CommitRecord): void {
  validateSchema("checkpoint", value);
  if (
    value.sequence === "00000000000000000000"
      ? value.parent_commit_key !== null || value.parent_commit_sha256 !== null
      : value.parent_commit_key === null || value.parent_commit_sha256 === null
  )
    throw new AgentError("corrupt", "Invalid parent links");
}

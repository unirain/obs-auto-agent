import {
  AgentError,
  canonicalJson,
  sha256,
  type WorkspaceManifest,
  type CommitRecord,
  type ManifestFile,
  type ObjectStore,
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
    validateManifestFile(f);
    if (paths.has(f.path))
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
export function manifestBlobs(
  file: ManifestFile,
): { sha256: string; size: number }[] {
  return file.chunks ?? [{ sha256: file.sha256, size: file.size }];
}
export function validateManifestFile(file: ManifestFile): void {
  validateSchema("manifest_file", file);
  validatePath(file.path);
  if (!file.chunks) {
    if (file.size > MAX_FILE_BYTES)
      throw new AgentError("corrupt", "Oversized unchunked blob");
    return;
  }
  if (
    file.size <= MAX_FILE_BYTES ||
    file.chunks.reduce((sum, c) => sum + c.size, 0) !== file.size ||
    file.chunks.slice(0, -1).some((c) => c.size !== MAX_FILE_BYTES)
  )
    throw new AgentError("corrupt", "Invalid logical file chunks");
}
/** Verify every physical blob and the final logical bytes before returning any file. */
export async function readManifestFile(
  store: ObjectStore,
  prefix: string,
  file: ManifestFile,
): Promise<Uint8Array> {
  validateManifestFile(file);
  const parts: Uint8Array[] = [];
  for (const chunk of manifestBlobs(file)) {
    const bytes = await store.read(prefix + "blobs/" + chunk.sha256);
    assertBytes(bytes, chunk.sha256, chunk.size);
    parts.push(bytes);
  }
  const bytes =
    parts.length === 1 ? parts[0]! : Buffer.concat(parts, file.size);
  assertBytes(bytes, file.sha256, file.size);
  return bytes;
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

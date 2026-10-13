import { normalizeUrl } from "../collect/identity.js";
import { validateStaticSVG } from "./svg.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../contracts/index.js";
import type { SealedDelivery, PreparedCommit } from "./types.js";
export const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
export function deliveryValidationHash(d: SealedDelivery): string {
  return sha256(
    canonicalJson({
      files: d.files.map(({ path, sha256: hash, bytes, mime, role }) => ({
        path,
        hash,
        bytes,
        mime,
        role,
      })),
      resources: d.resources,
    }),
  );
}
export function validateDelivery(
  d: SealedDelivery,
  workspace: { id: string; revision: string },
): void {
  if (
    d.schema_version !== 1 ||
    d.execution_scope !== "production" ||
    d.workspace_id !== workspace.id ||
    !d.workspace_revision ||
    !workspace.revision
  )
    throw new Error("Invalid committed production delivery identity");
  if (
    !/^[a-zA-Z0-9_-]+$/.test(d.project_id) ||
    !/^[a-zA-Z0-9_-]+$/.test(d.delivery_id) ||
    !Number.isSafeInteger(d.generation_version) ||
    d.generation_version < 1
  )
    throw new Error("Invalid delivery identity");
  if (
    !/^[a-f0-9]{40}$/.test(d.base_commit) ||
    !isUtcInstant(d.sources_verified_at) ||
    !d.files.length ||
    !d.sources.length
  )
    throw new Error("Missing source verification or base commit");
  if (d.primary_source_aliases !== undefined) {
    if (
      !Array.isArray(d.primary_source_aliases) ||
      d.primary_source_aliases.some((alias) => typeof alias !== "string")
    )
      throw new Error("Invalid primary source aliases");
    for (const alias of d.primary_source_aliases) normalizeUrl(alias);
  }
  const paths = new Set<string>();
  let notes = 0;
  for (const file of d.files) {
    const segments = file.path.split("/");
    if (
      file.symlink ||
      file.path.includes("\\") ||
      segments.some(
        (x) => x === "" || x === "." || x === ".." || x.startsWith("."),
      ) ||
      paths.has(file.path)
    )
      throw new Error("Unsafe, duplicate or symlink delivery path");
    paths.add(file.path);
    if (file.role === "note") {
      notes++;
      if (
        !file.path.startsWith("Organize Notes By AI/") ||
        !file.path.endsWith(".md") ||
        file.mime !== "text/markdown"
      )
        throw new Error("Invalid note path/MIME");
      const text = Buffer.from(file.content).toString("utf8");
      for (const match of text.matchAll(
        /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g,
      )) {
        if (!d.resources.some((r) => r.url === match[1]))
          throw new Error("Unreceipted remote image");
      }
    } else if (
      !file.path.startsWith("图文件/") ||
      !/\.(drawio|svg|mmd|json)$/.test(file.path) ||
      ![
        "application/xml",
        "image/svg+xml",
        "text/plain",
        "application/json",
      ].includes(file.mime)
    )
      throw new Error("Invalid diagram source path/MIME");
    if (file.path.endsWith(".svg")) validateStaticSVG(file.content);
    if (
      file.bytes !== file.content.byteLength ||
      file.sha256 !== sha256(file.content)
    )
      throw new Error("Delivery content hash/size mismatch");
  }
  if (notes !== 1)
    throw new Error("Each delivery must contain exactly one note");
  for (const r of d.resources) {
    parseResourceReceipt(r);
    if (
      r.project_id !== d.project_id ||
      !/^[a-f0-9]{64}$/.test(r.sha256) ||
      !r.object_key.includes(r.sha256) ||
      !r.url.startsWith("https://") ||
      r.bytes <= 0
    )
      throw new Error("Invalid resource receipt");
  }
  if (d.validated_hash !== deliveryValidationHash(d))
    throw new Error("Final validation is stale");
}

/** Restored expected commit content must still be the sealed artifact; never emit objects from an unbound intent. */
export function validatePreparedFiles(
  d: SealedDelivery,
  p: PreparedCommit,
): void {
  assertUtcInstant(p.identity.date, "prepared Git identity date");
  if (
    p.base_commit !== d.base_commit ||
    p.files.length !== d.files.length ||
    p.blobs.length !== d.files.length ||
    new Set(p.blobs.map((b) => b.path)).size !== p.blobs.length
  )
    throw new Error("Prepared commit file/base binding changed");
  for (const file of d.files) {
    const recorded = p.files.find((f) => f.path === file.path);
    const blob = p.blobs.find((b) => b.path === file.path);
    if (!recorded || recorded.sha256 !== file.sha256 || !blob)
      throw new Error("Prepared commit file hash changed");
    const bytes = Buffer.from(blob.content_base64, "base64");
    const gitSHA = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (sha256(bytes) !== file.sha256 || gitSHA !== blob.sha)
      throw new Error("Prepared commit blob differs from sealed artifact");
  }
}
import { assertUtcInstant, isUtcInstant } from "../contracts/utc.js";
import { parseResourceReceipt } from "./contracts.js";

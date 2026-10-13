import OSS from "ali-oss";
import type { Deployment } from "../config/deployment.js";
import { parseDeployment } from "../config/deployment.js";
import type { OssCredentials } from "../config/credentials.js";
import { OssObjectStore } from "../storage/oss.js";
import { OSSImageGCStore } from "./image-gc-oss.js";
import {
  collectImageGarbage,
  imageProtection,
  type ImageGCResult,
} from "./image-gc.js";
import type { OperationsJournal } from "./types.js";
import type { OctokitGitHub } from "./github.js";
export interface ImageGCBootstrapOptions {
  deployment: Deployment;
  credentials?: OssCredentials;
  credential_reference: string;
  github?: Pick<OctokitGitHub, "imageReferences">;
  journal: OperationsJournal;
  records: () => Readonly<Record<string, unknown>>;
  beforeDelete: (
    project: string,
    key: string,
    version: string | null,
  ) => Promise<void>;
  afterKeyAbsent: (key: string) => Promise<void>;
  now?: () => Date;
}
/** Separate GC identity is mandatory: normal image uploader policies intentionally cannot delete. */
export function imageGCFromTrustedHost(
  options: ImageGCBootstrapOptions,
): () => Promise<ImageGCResult> {
  const d = parseDeployment(options.deployment);
  if (d.execution_scope === "preview")
    throw new Error("Preview cannot construct image cleanup client");
  const expected =
    d.name === "integration"
      ? "TEST_IMAGE_GC_CREDENTIALS"
      : "READING_IMAGE_GC_CREDENTIALS";
  if (options.credential_reference !== expected)
    throw new Error("GC credential reference/profile mismatch");
  const now = options.now ?? (() => new Date());
  const unavailable = (reason: string): ImageGCResult => {
    const keys = d.image
      ? [
          ...imageProtection(
            options.records(),
            d.image.prefix,
            now(),
          ).receipts.keys(),
        ]
      : [];
    return {
      complete: false,
      deleted: [],
      retained: keys,
      unknown: keys,
      reason,
    };
  };
  if (
    !options.credentials ||
    !options.github ||
    !d.image ||
    !d.image.sole_writer_verified ||
    d.image.versioning === "unknown"
  )
    return async () =>
      unavailable("dedicated_gc_identity_or_verified_image_binding_missing");
  if (!options.credentials.accessKeyId || !options.credentials.accessKeySecret)
    throw new Error("Invalid dedicated GC credential structure");
  const image = d.image;
  const versioning = image.versioning as "disabled" | "enabled" | "suspended";
  const inventory = new OssObjectStore({
    ...options.credentials,
    bucket: image.bucket,
    region: image.region,
    endpoint: image.endpoint,
    allowed_prefix: image.prefix,
  });
  const client = new OSS({
    ...options.credentials,
    bucket: image.bucket,
    region: image.region,
    endpoint: image.endpoint,
    secure: true,
    timeout: 30_000,
  });
  const store = new OSSImageGCStore(
    client,
    inventory,
    image.prefix,
    versioning,
  );
  return async () => {
    try {
      const actual = (await inventory.configuration()).versioning;
      if (actual !== (versioning === "disabled" ? "never" : versioning))
        return unavailable("live_image_versioning_does_not_match_binding");
    } catch {
      return unavailable("live_image_gc_preflight_unavailable");
    }
    return collectImageGarbage({
      execution_scope: "production",
      prefix: image.prefix,
      journal: options.journal,
      records: options.records,
      store,
      references: () => options.github!.imageReferences(),
      beforeDelete: options.beforeDelete,
      afterKeyAbsent: options.afterKeyAbsent,
      now,
    });
  };
}

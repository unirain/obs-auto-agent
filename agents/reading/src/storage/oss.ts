import OSS from "ali-oss";
import {
  AgentError,
  type ObjectStore,
  type ObjectMetadata,
  type ObjectPage,
  type BucketConfiguration,
} from "../contracts/index.js";
export interface OssStoreOptions {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  stsToken?: string;
  timeout_ms?: number;
  page_size?: number;
  allowed_prefix?: string;
}
type VersioningClient = OSS & {
  getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }>;
};
export function classifyOssError(error: unknown): AgentError {
  const e = error as { code?: string; status?: number };
  if (e.code === "NoSuchKey")
    return new AgentError("not_found", "OSS object absent");
  if (e.code === "FileAlreadyExists" || e.status === 409)
    return new AgentError("conflict", "OSS immutable object exists");
  if (e.status === 403 || e.code === "AccessDenied")
    return new AgentError("permission", "OSS permission denied");
  if (e.code === "NoSuchBucket" || e.status === 400)
    return new AgentError("configuration", "OSS configuration invalid");
  if (e.status && e.status >= 500)
    return new AgentError("transient", "OSS service temporarily unavailable");
  return new AgentError("unknown", "OSS response outcome unknown");
}
export class OssObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly client: VersioningClient;
  private readonly endpoint: string;
  constructor(private readonly options: OssStoreOptions) {
    this.bucket = options.bucket;
    this.endpoint = options.endpoint.startsWith("https://")
      ? options.endpoint
      : "https://" + options.endpoint;
    const url = new URL(this.endpoint);
    if (
      url.protocol !== "https:" ||
      url.hostname.includes("-internal.") ||
      !url.hostname.endsWith(".aliyuncs.com")
    )
      throw new AgentError(
        "configuration",
        "Native public OSS HTTPS endpoint required",
      );
    this.client = new OSS({
      bucket: options.bucket,
      region: options.region,
      endpoint: this.endpoint,
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      ...(options.stsToken ? { stsToken: options.stsToken } : {}),
      timeout: options.timeout_ms ?? 30000,
      secure: true,
    }) as VersioningClient;
  }
  private guard(key: string): void {
    if (
      !key ||
      key.startsWith("/") ||
      key.includes("\\") ||
      key.split("/").some((s) => s === ".." || s === "." || s === "")
    )
      throw new AgentError("configuration", "Invalid OSS key");
    if (
      this.options.allowed_prefix &&
      !key.startsWith(this.options.allowed_prefix)
    )
      throw new AgentError("scope", "Object key outside adapter capability");
  }
  async create(key: string, bytes: Uint8Array): Promise<void> {
    this.guard(key);
    try {
      await this.client.put(key, Buffer.from(bytes), {
        headers: { "x-oss-forbid-overwrite": "true" },
      });
    } catch (e) {
      throw classifyOssError(e);
    }
  }
  async read(key: string): Promise<Uint8Array> {
    this.guard(key);
    try {
      const result = await this.client.get(key);
      return Uint8Array.from(result.content);
    } catch (e) {
      throw classifyOssError(e);
    }
  }
  async stat(key: string): Promise<ObjectMetadata> {
    this.guard(key);
    try {
      const result = await this.client.head(key);
      const h = result.res.headers as Record<string, string>;
      const size = Number(h["content-length"]);
      if (!Number.isSafeInteger(size) || size < 0)
        throw new AgentError("corrupt", "OSS size invalid");
      return {
        key,
        size,
        created_at: new Date(h["last-modified"]!).toISOString(),
        ...(h["x-oss-version-id"] ? { version: h["x-oss-version-id"] } : {}),
      };
    } catch (e) {
      if (e instanceof AgentError) throw e;
      throw classifyOssError(e);
    }
  }
  async list(prefix: string, cursor?: string): Promise<ObjectPage> {
    if (
      this.options.allowed_prefix &&
      !prefix.startsWith(this.options.allowed_prefix)
    )
      throw new AgentError("scope", "List outside adapter capability");
    try {
      const page = await this.client.listV2({
        prefix,
        "max-keys": this.options.page_size ?? 1000,
        ...(cursor ? { "continuation-token": cursor } : {}),
      });
      if (page.isTruncated && !page.nextContinuationToken)
        throw new AgentError(
          "corrupt",
          "OSS truncated listing missing continuation",
        );
      return {
        objects: (page.objects ?? []).map((o) => ({
          key: o.name,
          size: o.size,
          created_at: new Date(o.lastModified).toISOString(),
        })),
        next_cursor: page.isTruncated ? page.nextContinuationToken : null,
      };
    } catch (e) {
      if (e instanceof AgentError) throw e;
      throw classifyOssError(e);
    }
  }
  async inventoryVersions(
    prefix: string,
  ): Promise<(ObjectMetadata & { bucket: string })[]> {
    if (
      this.options.allowed_prefix &&
      !prefix.startsWith(this.options.allowed_prefix)
    )
      throw new AgentError("scope", "Inventory outside adapter capability");
    const client = this.client as unknown as {
      getBucketVersions(query: {
        prefix: string;
        maxKeys: number;
        keyMarker?: string;
        versionIdMarker?: string;
      }): Promise<{
        objects: {
          name: string;
          size: number;
          lastModified: string;
          versionId: string;
        }[];
        isTruncated: boolean;
        nextKeyMarker: string | null;
        nextVersionIdMarker: string | null;
      }>;
    };
    const objects: (ObjectMetadata & { bucket: string })[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    const seen = new Set<string>();
    try {
      do {
        const page = await client.getBucketVersions({
          prefix,
          maxKeys: this.options.page_size ?? 1000,
          ...(keyMarker ? { keyMarker } : {}),
          ...(versionIdMarker ? { versionIdMarker } : {}),
        });
        objects.push(
          ...page.objects.map((o) => ({
            bucket: this.bucket,
            key: o.name,
            size: o.size,
            created_at: new Date(o.lastModified).toISOString(),
            version: o.versionId,
          })),
        );
        if (!page.isTruncated) return objects;
        if (!page.nextKeyMarker || !page.nextVersionIdMarker)
          throw new AgentError(
            "corrupt",
            "Version inventory continuation missing",
          );
        const marker = JSON.stringify([
          page.nextKeyMarker,
          page.nextVersionIdMarker,
        ]);
        if (seen.has(marker))
          throw new AgentError("corrupt", "Version inventory did not advance");
        seen.add(marker);
        keyMarker = page.nextKeyMarker;
        versionIdMarker = page.nextVersionIdMarker;
      } while (true);
    } catch (e) {
      if (e instanceof AgentError) throw e;
      throw classifyOssError(e);
    }
  }
  async delete(key: string): Promise<void> {
    this.guard(key);
    if (key.includes("/commits/"))
      throw new AgentError("permission", "Commit deletion forbidden");
    try {
      await this.client.delete(key);
    } catch (e) {
      throw classifyOssError(e);
    }
  }
  async configuration(): Promise<BucketConfiguration> {
    try {
      const version = await this.client.getBucketVersioning(this.bucket);
      const acl = await this.client.getBucketACL(this.bucket);
      let lifecycle: BucketConfiguration["lifecycle"] = [];
      try {
        const rules = await this.client.getBucketLifecycle(this.bucket);
        lifecycle = rules.rules.map((r) => ({
          prefix: r.prefix,
          expires:
            r.status === "Enabled" && (r.days !== undefined || Boolean(r.date)),
        }));
      } catch (e) {
        if ((e as { code?: string }).code !== "NoSuchLifecycle") throw e;
      }
      let anonymous = false;
      try {
        const p = await this.client.getBucketPolicy(this.bucket);
        const policy =
          typeof p.policy === "string" ? JSON.parse(p.policy) : p.policy;
        const serialized = JSON.stringify(policy);
        if (serialized.includes('"Allow"') && serialized.includes('"*"'))
          anonymous = true;
      } catch (e) {
        if ((e as { code?: string }).code !== "NoSuchBucketPolicy") throw e;
      }
      if (!["private", "public-read", "public-read-write"].includes(acl.acl))
        throw new AgentError("configuration", "Unknown bucket ACL");
      if (
        version.versionStatus &&
        !["Enabled", "Suspended"].includes(version.versionStatus)
      )
        throw new AgentError("configuration", "Unknown versioning state");
      return {
        versioning:
          version.versionStatus === "Enabled"
            ? "enabled"
            : version.versionStatus === "Suspended"
              ? "suspended"
              : "never",
        acl: acl.acl as BucketConfiguration["acl"],
        endpoint: this.endpoint,
        lifecycle,
        anonymous_readable: anonymous,
      };
    } catch (e) {
      if (e instanceof AgentError) throw e;
      throw classifyOssError(e);
    }
  }
}
export function createObjectStore(options: OssStoreOptions): ObjectStore {
  return new OssObjectStore(options);
}

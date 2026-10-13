import type OSS from "ali-oss";
import { classifyOssError, type OssObjectStore } from "../storage/oss.js";
import type { ImageGCStore, ImageVersion } from "./image-gc.js";
import type { ImageObject } from "./resources.js";
type VersionClient = {
  get(
    name: string,
    file: undefined,
    options: { timeout: number; versionId?: string },
  ): Promise<{ content: unknown; res: { headers: Record<string, string> } }>;
  delete(
    name: string,
    options: { timeout: number; versionId?: string },
  ): Promise<unknown>;
};
/** The installed ali-oss object/get.js and delete.js map versionId into native OSS version subresources. */
export class OSSImageGCStore implements ImageGCStore {
  private versionClient: VersionClient;
  constructor(
    client: OSS,
    private inventoryStore: OssObjectStore,
    private prefix: string,
    private versioning: "disabled" | "enabled" | "suspended" = "disabled",
  ) {
    this.versionClient = client as unknown as VersionClient;
    if (!prefix.endsWith("/") || prefix.includes(".."))
      throw new Error("Invalid image cleanup prefix");
  }
  private guard(key: string) {
    if (
      !key.startsWith(this.prefix) ||
      key.includes("..") ||
      key.includes("\\")
    )
      throw new Error("Image cleanup key outside trusted prefix");
  }
  async inventory(): Promise<{ complete: boolean; objects: ImageVersion[] }> {
    const objects = await this.inventoryStore.inventoryVersions(this.prefix);
    return {
      complete: true,
      objects: objects.map((o) => ({
        key: o.key,
        version_id: o.version === "null" ? null : (o.version ?? null),
        bytes: o.size,
        created_at: o.created_at,
      })),
    };
  }
  async getVersion(
    key: string,
    version: string | null,
  ): Promise<ImageObject | null> {
    this.guard(key);
    try {
      const r = await this.versionClient.get(key, undefined, {
        timeout: 30000,
        ...(version !== null || this.versioning !== "disabled"
          ? { versionId: version ?? "null" }
          : {}),
      });
      return {
        content: Buffer.from(r.content as Uint8Array),
        mime: r.res.headers["content-type"] ?? "application/octet-stream",
        version_id: version,
      };
    } catch (e) {
      const err = classifyOssError(e);
      if (
        err.code === "not_found" ||
        (typeof e === "object" &&
          e !== null &&
          "code" in e &&
          e.code === "NoSuchVersion")
      )
        return null;
      throw err;
    }
  }
  async deleteVersion(key: string, version: string | null): Promise<void> {
    this.guard(key);
    try {
      await this.versionClient.delete(key, {
        timeout: 30000,
        ...(version !== null || this.versioning !== "disabled"
          ? { versionId: version ?? "null" }
          : {}),
      });
    } catch (e) {
      throw classifyOssError(e);
    }
  }
}

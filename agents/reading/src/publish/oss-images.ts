import OSS from "ali-oss";
import { classifyOssError } from "../storage/oss.js";
import type { ImageObject, ImageStore } from "./resources.js";
import { sha256 } from "./validate.js";
export class OSSImageStore implements ImageStore {
  constructor(
    private client: OSS,
    private publicBaseURL: string,
    private allowedPrefix: string,
    private timeoutMS = 30_000,
  ) {
    if (
      !publicBaseURL.startsWith("https://") ||
      !allowedPrefix.endsWith("/") ||
      allowedPrefix.includes("..")
    )
      throw new Error("Invalid image destination");
  }
  private key(key: string): void {
    if (
      !key.startsWith(this.allowedPrefix) ||
      key.includes("..") ||
      key.includes("\\")
    )
      throw new Error("Image key outside trusted prefix");
  }
  async get(key: string): Promise<ImageObject | null> {
    this.key(key);
    try {
      const result = await this.client.get(key, undefined, {
        timeout: this.timeoutMS,
      });
      const headers = result.res.headers as Record<string, string>;
      return {
        content: Buffer.from(result.content),
        mime: headers["content-type"] ?? "application/octet-stream",
        version_id: headers["x-oss-version-id"] ?? null,
      };
    } catch (e) {
      // Only the service's definitive NoSuchKey means absent. Permission/timeouts are unknown.
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "NoSuchKey"
      )
        return null;
      throw classifyOssError(e);
    }
  }
  async create(key: string, content: Uint8Array, mime: string): Promise<void> {
    this.key(key);
    try {
      await this.client.put(key, Buffer.from(content), {
        mime,
        timeout: this.timeoutMS,
        headers: { "x-oss-forbid-overwrite": "true" },
      });
    } catch (error) {
      throw classifyOssError(error);
    }
  }
  url(key: string): string {
    this.key(key);
    return `${this.publicBaseURL.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async accessible(url: string, expectedHash: string): Promise<boolean> {
    if (!url.startsWith(this.publicBaseURL.replace(/\/$/, "") + "/"))
      throw new Error("Unexpected image URL");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMS),
      redirect: "error",
    });
    return (
      response.ok &&
      sha256(new Uint8Array(await response.arrayBuffer())) === expectedHash
    );
  }
}

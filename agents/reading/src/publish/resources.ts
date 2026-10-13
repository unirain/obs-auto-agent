import { AgentError } from "../contracts/index.js";
import { validateStaticSVG } from "./svg.js";
import { sha256 } from "./validate.js";
import type {
  OperationsJournal,
  PermissionCheck,
  ResourceReceipt,
} from "./types.js";
export interface ImageObject {
  content: Uint8Array;
  mime: string;
  version_id: string | null;
}
export interface ImageStore {
  get(key: string): Promise<ImageObject | null>;
  create(key: string, content: Uint8Array, mime: string): Promise<void>;
  url(key: string): string;
  accessible(url: string, expectedHash: string): Promise<boolean>;
}
export interface ResourceCapacity {
  reserve(id: string, bytes: number): Promise<void>;
  confirm(id: string, receipt: ResourceReceipt): Promise<void>;
}
export interface ResourceInput {
  project_id: string;
  first_generated_date: string;
  article_slug: string;
  description: string;
  extension: "png" | "jpg" | "svg" | "webp";
  mime: string;
  content: Uint8Array;
}
interface UploadIntent {
  status: "reserved" | "unknown" | "confirmed";
  object_key: string;
  sha256: string;
  bytes: number;
  mime: string;
  receipt: ResourceReceipt | null;
}
export class ResourcePublisher {
  constructor(
    private store: ImageStore,
    private journal: OperationsJournal,
    private capacity: ResourceCapacity,
    private permission: PermissionCheck,
    private prefix = "reading-agent/",
    private now = () => new Date(),
  ) {
    if (!prefix.endsWith("/") || prefix.includes(".."))
      throw new Error("Unsafe image prefix");
  }
  async upload(input: ResourceInput): Promise<ResourceReceipt> {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(input.project_id) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.first_generated_date) ||
      !/^[a-z0-9_-]+$/i.test(input.article_slug) ||
      !/^[a-z0-9_-]+$/i.test(input.description)
    )
      throw new Error("Invalid resource naming");
    const types = {
      png: "image/png",
      jpg: "image/jpeg",
      svg: "image/svg+xml",
      webp: "image/webp",
    };
    if (types[input.extension] !== input.mime || input.content.byteLength === 0)
      throw new Error("Invalid resource MIME/size");
    const head = Buffer.from(input.content.subarray(0, 256));
    if (
      (input.extension === "png" &&
        !head
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (input.extension === "jpg" && (head[0] !== 255 || head[1] !== 216)) ||
      (input.extension === "webp" &&
        (head.toString("ascii", 0, 4) !== "RIFF" ||
          head.toString("ascii", 8, 12) !== "WEBP")) ||
      (input.extension === "svg" && !head.toString("utf8").includes("<svg"))
    )
      throw new Error("Resource bytes do not match MIME");
    if (input.extension === "svg") validateStaticSVG(input.content);
    const hash = sha256(input.content);
    const key = `${this.prefix}${input.project_id}/${input.first_generated_date}-${input.article_slug}-${input.description}-${hash}.${input.extension}`;
    const journalKey = `resource-${sha256(key)}`;
    let intent = await this.journal.load<UploadIntent>(journalKey);
    if (
      intent &&
      (intent.sha256 !== hash || intent.bytes !== input.content.byteLength)
    )
      throw new Error("Resource intent conflict");
    if (intent?.status === "confirmed" && intent.receipt) return intent.receipt;
    await this.permission("upload_resource", input.project_id);
    if (!intent) {
      await this.capacity.reserve(key, input.content.byteLength);
      intent = {
        status: "reserved",
        object_key: key,
        sha256: hash,
        bytes: input.content.byteLength,
        mime: input.mime,
        receipt: null,
      };
      await this.journal.commit(journalKey, intent);
    }
    // Read before writing, including on a fresh process after a lost response.
    let existing = await this.store.get(key);
    if (!existing) {
      await this.permission("upload_resource", input.project_id);
      await this.journal.commit(journalKey, { ...intent, status: "unknown" });
      try {
        await this.store.create(key, input.content, input.mime);
      } catch (error) {
        if (
          error instanceof AgentError &&
          ["permission", "configuration"].includes(error.code)
        ) {
          await this.journal.commit(journalKey, {
            ...intent,
            status: "reserved",
          });
          throw error; // Definitive service denial differs from a lost response.
        }
        /* read-back decides; unknown never frees capacity */
      }
      existing = await this.store.get(key);
      if (!existing)
        throw new Error("Upload result unknown; reservation retained");
    }
    if (
      sha256(existing.content) !== hash ||
      existing.content.byteLength !== intent.bytes ||
      existing.mime !== input.mime
    )
      throw new Error("Immutable image content conflict");
    const url = this.store.url(key);
    if (!(await this.store.accessible(url, hash)))
      throw new Error("Image URL unverified; reservation retained");
    const receipt: ResourceReceipt = {
      object_key: key,
      sha256: hash,
      bytes: intent.bytes,
      mime: input.mime,
      url,
      project_id: input.project_id,
      version_id: existing.version_id,
      confirmed_at: this.now().toISOString(),
    };
    await this.capacity.confirm(key, receipt);
    await this.journal.commit(journalKey, {
      ...intent,
      status: "confirmed",
      receipt,
    });
    return receipt;
  }
}

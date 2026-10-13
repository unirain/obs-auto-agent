import {
  mkdir,
  readFile,
  writeFile,
  stat,
  readdir,
  unlink,
  link,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AgentError,
  sha256,
  type ObjectStore,
  type ObjectMetadata,
  type ObjectPage,
  type BucketConfiguration,
} from "../contracts/index.js";
export type Fault = {
  operation: "create" | "read" | "stat" | "list" | "delete" | "configuration";
  key?: string;
  kind: "before" | "after" | "corrupt" | "permission";
  remaining?: number;
};
/** Durable protocol test adapter: a new instance on the same root observes prior effects. */
export class FileObjectStore implements ObjectStore {
  readonly bucket = "local-protocol-test";
  readonly faults: Fault[] = [];
  readonly calls: { operation: string; key: string; sha256?: string }[] = [];
  constructor(
    readonly root: string,
    readonly page_size = 100,
    private config: BucketConfiguration = {
      versioning: "never",
      acl: "private",
      endpoint: "https://local.invalid",
      lifecycle: [],
      anonymous_readable: false,
    },
  ) {}
  private path(key: string): string {
    if (
      !key ||
      key.startsWith("/") ||
      key.split("/").some((p) => p === ".." || p === "." || p === "") ||
      key.includes("\\")
    )
      throw new AgentError("configuration", "Invalid object key");
    return join(this.root, ...key.split("/"));
  }
  private fault(
    op: Fault["operation"],
    key: string,
    after: boolean,
  ): Fault | undefined {
    const f = this.faults.find(
      (f) =>
        f.operation === op &&
        (!f.key || f.key === key) &&
        (f.remaining ?? 1) > 0 &&
        (after ? f.kind === "after" : f.kind !== "after"),
    );
    if (!f) return;
    f.remaining = (f.remaining ?? 1) - 1;
    if (f.kind === "corrupt") return f;
    throw new AgentError(
      f.kind === "permission" ? "permission" : after ? "unknown" : "transient",
      `Injected ${op} fault`,
    );
  }
  async create(key: string, bytes: Uint8Array): Promise<void> {
    this.calls.push({ operation: "create", key, sha256: sha256(bytes) });
    this.fault("create", key, false);
    const path = this.path(key);
    await mkdir(join(path, ".."), { recursive: true });
    const temporaryDir = join(this.root, ".pending");
    await mkdir(temporaryDir, { recursive: true });
    const temporary = join(temporaryDir, randomUUID());
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      // Link publishes fully written bytes atomically and rejects existing keys.
      await link(temporary, path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new AgentError("conflict", "Object already exists");
      throw e;
    } finally {
      await unlink(temporary).catch(() => {});
    }
    this.fault("create", key, true);
  }
  async read(key: string): Promise<Uint8Array> {
    this.calls.push({ operation: "read", key });
    const f = this.fault("read", key, false);
    try {
      const b = await readFile(this.path(key));
      if (f?.kind === "corrupt") return new Uint8Array([...b, 0]);
      return b;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new AgentError("not_found", "Object absent");
      throw e;
    }
  }
  async stat(key: string): Promise<ObjectMetadata> {
    this.calls.push({ operation: "stat", key });
    const fault = this.fault("stat", key, false);
    try {
      const s = await stat(this.path(key));
      this.fault("stat", key, true);
      return {
        key,
        size: s.size + (fault?.kind === "corrupt" ? 1 : 0),
        created_at: s.birthtime.toISOString(),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new AgentError("not_found", "Object absent");
      throw e;
    }
  }
  async list(prefix: string, cursor?: string): Promise<ObjectPage> {
    this.calls.push({ operation: "list", key: prefix });
    this.fault("list", prefix, false);
    const all: ObjectMetadata[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink())
          throw new AgentError("corrupt", "Object root contains symlink");
        const key = rel + entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), key + "/");
        else if (key.startsWith(prefix)) all.push(await this.stat(key));
      }
    };
    await walk(this.root, "");
    all.sort((a, b) => a.key.localeCompare(b.key));
    const start = cursor ? all.findIndex((o) => o.key > cursor) : 0;
    const objects = start < 0 ? [] : all.slice(start, start + this.page_size);
    this.fault("list", prefix, true);
    return {
      objects,
      next_cursor:
        start >= 0 && start + this.page_size < all.length
          ? objects.at(-1)!.key
          : null,
    };
  }
  async delete(key: string): Promise<void> {
    if (key.includes("/commits/"))
      throw new AgentError("permission", "Commit deletion forbidden");
    this.calls.push({ operation: "delete", key });
    this.fault("delete", key, false);
    try {
      await unlink(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    this.fault("delete", key, true);
  }
  async configuration(): Promise<BucketConfiguration> {
    this.calls.push({ operation: "configuration", key: this.bucket });
    const fault = this.fault("configuration", this.bucket, false);
    this.fault("configuration", this.bucket, true);
    return {
      ...structuredClone(this.config),
      ...(fault?.kind === "corrupt"
        ? { versioning: "invalid" as BucketConfiguration["versioning"] }
        : {}),
    };
  }
}

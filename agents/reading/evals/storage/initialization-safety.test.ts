import { it, expect } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BucketConfiguration,
  ObjectPage,
} from "../../src/contracts/index.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { classifyOssError } from "../../src/storage/oss.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { validateHostRecords } from "../../src/app/records.js";

const workspaceId = "obs-notes-hub/reading-integration";
const privateBucket: BucketConfiguration = {
  versioning: "never",
  acl: "private",
  endpoint: "https://oss-cn-beijing.aliyuncs.com",
  lifecycle: [],
  anonymous_readable: false,
};
type MissingBucketBoundary = "configuration" | "list" | "zero_probe";

/** The service error is a fault fixture, not an OSS request or a RAM permission proof. */
class MissingBucketStore extends FileObjectStore {
  constructor(
    root: string,
    private readonly boundary: MissingBucketBoundary,
  ) {
    super(root, 100, privateBucket);
  }
  private missing(): never {
    // NoSuchBucket and NoSuchKey both use 404. Exercise the real adapter classifier,
    // so the manager cannot silently classify every 404 as an absent object.
    throw classifyOssError({ code: "NoSuchBucket", status: 404 });
  }
  override async configuration(): Promise<BucketConfiguration> {
    if (this.boundary === "configuration") {
      this.calls.push({ operation: "configuration", key: "" });
      return this.missing();
    }
    return super.configuration();
  }
  override async list(prefix: string, cursor?: string): Promise<ObjectPage> {
    if (this.boundary === "list") {
      this.calls.push({ operation: "list", key: prefix });
      return this.missing();
    }
    return super.list(prefix, cursor);
  }
  override async read(key: string): Promise<Uint8Array> {
    if (this.boundary === "zero_probe") {
      this.calls.push({ operation: "read", key });
      return this.missing();
    }
    return super.read(key);
  }
}
function manager(store: FileObjectStore, local: string) {
  return new ImmutableWorkspaceManager({
    store,
    scope: "production",
    trusted_workspace_id: workspaceId,
    prefix: "reading-agent/integration",
    local_root: local,
    record_validator: validateHostRecords,
    // Keep the actual default preflight on: disabling it would bypass the scenario.
  });
}
async function assertUntouched(store: FileObjectStore) {
  expect(
    store.calls.filter((call) => ["create", "delete"].includes(call.operation)),
  ).toEqual([]);
  // Inspect the backing service namespace independently of the faulty read adapter.
  // A failed initialization must leave no manifest, commit, blob or pending file.
  expect(
    await readdir(store.root).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }),
  ).toEqual([]);
}

it.each(["configuration", "list", "zero_probe"] as const)(
  "missing bucket at %s refuses explicit initialization before writes and still refuses after cold restart",
  async (boundary) => {
    const root = await mkdtemp(join(tmpdir(), "reading-missing-bucket-"));
    const objects = join(root, "objects");
    try {
      for (const run of ["first", "cold-restart"]) {
        // No adapter or manager state survives into the second client.
        const store = new MissingBucketStore(objects, boundary);
        await expect(
          manager(store, join(root, run)).restore(workspaceId, {
            allow_initialize: true,
            run_id: run,
          }),
        ).rejects.toMatchObject({
          code: "configuration",
          message: "OSS configuration invalid",
        });
        await assertUntouched(store);
        const expected =
          boundary === "configuration"
            ? ["configuration"]
            : boundary === "list"
              ? ["configuration", "list"]
              : ["configuration", "list", "read"];
        expect(store.calls.map((call) => call.operation)).toEqual(expected);
        if (boundary === "zero_probe")
          expect(store.calls.at(-1)?.key).toBe(
            `reading-agent/integration/${workspaceId}/commits/00000000000000000000.json`,
          );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(["public-read", "public-read-write"] as const)(
  "%s ACL refuses explicit initialization before writes and still refuses after cold restart",
  async (acl) => {
    const root = await mkdtemp(join(tmpdir(), "reading-public-acl-"));
    const objects = join(root, "objects");
    try {
      for (const run of ["first", "cold-restart"]) {
        const store = new FileObjectStore(objects, 100, {
          ...privateBucket,
          acl,
        });
        await expect(
          manager(store, join(root, run)).restore(workspaceId, {
            allow_initialize: true,
            run_id: run,
          }),
        ).rejects.toMatchObject({
          code: "configuration",
          message: "Workspace must be private",
        });
        expect(store.calls.map((call) => call.operation)).toEqual([
          "configuration",
        ]);
        await assertUntouched(store);
        expect(await store.configuration()).toMatchObject({ acl }); // no attempt to repair bucket settings
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("private ACL with anonymous access refuses initialization before writes and still refuses after cold restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-anonymous-access-"));
  const objects = join(root, "objects");
  try {
    for (const run of ["first", "cold-restart"]) {
      const store = new FileObjectStore(objects, 100, {
        ...privateBucket,
        anonymous_readable: true,
      });
      await expect(
        manager(store, join(root, run)).restore(workspaceId, {
          allow_initialize: true,
          run_id: run,
        }),
      ).rejects.toMatchObject({
        code: "configuration",
        message: "Workspace must be private",
      });
      expect(store.calls.map((call) => call.operation)).toEqual([
        "configuration",
      ]);
      await assertUntouched(store);
      expect(await store.configuration()).toMatchObject({
        acl: "private",
        anonymous_readable: true,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("a healthy private empty bucket explicitly missing only the zero object can initialize exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-private-init-"));
  const objects = join(root, "objects");
  try {
    expect(classifyOssError({ code: "NoSuchKey", status: 404 }).code).toBe(
      "not_found",
    );
    expect(classifyOssError({ code: "NoSuchBucket", status: 404 }).code).toBe(
      "configuration",
    );
    const first = new FileObjectStore(objects, 100, privateBucket);
    const initial = await manager(first, join(root, "first")).restore(
      workspaceId,
      { allow_initialize: true },
    );
    expect(initial.snapshot.sequence).toBe("00000000000000000000");
    expect(
      first.calls.filter(
        (call) => call.operation === "create" && call.key.includes("/commits/"),
      ),
    ).toHaveLength(1);
    const fresh = new FileObjectStore(objects, 100, privateBucket);
    const restored = await manager(fresh, join(root, "cold-restart")).restore(
      workspaceId,
      { allow_initialize: true },
    );
    expect(restored.revision).toBe(initial.revision);
    expect(restored.records).toEqual(initial.records);
    expect(
      fresh.calls.filter((call) =>
        ["create", "delete"].includes(call.operation),
      ),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

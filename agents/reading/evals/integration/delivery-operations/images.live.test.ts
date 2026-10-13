import { expect, it } from "vitest";
import OSS from "ali-oss";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseDeployment } from "../../../src/config/deployment.js";
import {
  OssObjectStore,
  type OssStoreOptions,
} from "../../../src/storage/oss.js";
import { ImmutableWorkspaceManager } from "../../../src/workspace/manager.js";
import { WorkspaceJournal } from "../../../src/app/journal.js";
import { capacityBrokerFromEnvironment } from "../../../src/storage/broker.js";
import {
  assertCapacity,
  capacityView,
  type StorageReservation,
} from "../../../src/storage/capacity.js";
import { sha256 } from "../../../src/contracts/index.js";
import {
  ResourcePublisher,
  type ImageStore,
  type ResourceInput,
} from "../../../src/publish/resources.js";
import { OSSImageStore } from "../../../src/publish/oss-images.js";
const enabled = process.env.READING_LIVE_IMAGES === "1";
it.skipIf(!enabled)(
  "real isolated OSS image loss recovery preserves stable object and one global reservation",
  async () => {
    const path = process.env.READING_LIVE_DEPLOYMENT;
    if (!path)
      throw new Error("Set verified isolated integration profile path");
    const d = parseDeployment(JSON.parse(await readFile(path, "utf8")));
    if (
      d.name !== "integration" ||
      !d.image?.prefix.includes("integration/") ||
      !d.image.sole_writer_verified ||
      d.image.versioning === "unknown"
    )
      throw new Error("Isolated image prerequisites missing");
    const secret = (name: string) => {
      const raw = process.env[name];
      if (!raw) throw new Error("Credential reference missing");
      const c = JSON.parse(raw) as Pick<
        OssStoreOptions,
        "accessKeyId" | "accessKeySecret" | "stsToken"
      >;
      if (!c.accessKeyId || !c.accessKeySecret)
        throw new Error("Credential structure invalid");
      return c;
    };
    const workspace = new OssObjectStore({
      ...secret(d.workspace.credential_ref),
      bucket: d.workspace.bucket,
      region: d.workspace.region,
      endpoint: d.workspace.endpoint,
      allowed_prefix: d.workspace.prefix,
    });
    const imageConfig = new OssObjectStore({
      ...secret(d.image.credential_ref),
      bucket: d.image.bucket,
      region: d.image.region,
      endpoint: d.image.endpoint,
      allowed_prefix: d.image.prefix,
    });
    const actual = (await imageConfig.configuration()).versioning;
    const expected =
      d.image.versioning === "disabled" ? "never" : d.image.versioning;
    if (actual !== expected)
      throw new Error("Image versioning differs from verified binding");
    const image = new OSSImageStore(
      new OSS({
        ...secret(d.image.credential_ref),
        bucket: d.image.bucket,
        region: d.image.region,
        endpoint: d.image.endpoint,
        secure: true,
      }),
      d.image.public_url,
      d.image.prefix,
    );
    const root = await mkdtemp(join(tmpdir(), "reading-live-images-"));
    const broker = capacityBrokerFromEnvironment(process.env, d);
    const id = `image_${randomUUID().replace(/-/g, "")}`;
    const manager = new ImmutableWorkspaceManager({
      store: workspace,
      scope: "production",
      trusted_workspace_id: d.workspace_id,
      local_root: root,
      prefix: d.workspace.prefix.replace(/\/$/, ""),
      capacity_check: async (bytes, kind) => {
        const inventory = await broker();
        assertCapacity(
          capacityView(inventory.objects, inventory.reservations),
          bytes,
          kind,
        );
      },
    });
    let handle = await manager.restore(d.workspace_id, {
      allow_initialize: true,
      run_id: id,
    });
    let journal = new WorkspaceJournal(manager, handle, id);
    const capacity = {
      reserve: async (key: string, bytes: number) => {
        const inventory = await broker();
        assertCapacity(
          capacityView(inventory.objects, inventory.reservations),
          bytes + 65536,
          "generation",
        );
        const r: StorageReservation = {
          reservation_id: sha256(key),
          execution_scope: "production",
          bucket: d.image!.bucket,
          key,
          version: null,
          expected_bytes: bytes,
          state: "pending",
        };
        await journal.commit(`storage/reservations/${r.reservation_id}`, r);
      },
      confirm: async (key: string, receipt: { version_id: string | null }) => {
        const r = await journal.load<StorageReservation>(
          `storage/reservations/${sha256(key)}`,
        );
        if (!r) throw new Error("Missing live reservation");
        await journal.commit(`storage/reservations/${r.reservation_id}`, {
          ...r,
          version: receipt.version_id,
          state: "confirmed",
        });
      },
    };
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=",
      "base64",
    );
    const input: ResourceInput = {
      project_id: id,
      first_generated_date: new Date(Date.now() + 8 * 3600000)
        .toISOString()
        .slice(0, 10),
      article_slug: "isolated-acceptance",
      description: "pixel",
      extension: "png",
      mime: "image/png",
      content: bytes,
    };
    await journal.commit(`live-images/${id}`, {
      ...input,
      content: undefined,
      content_base64: bytes.toString("base64"),
    });
    let writes = 0,
      afterWrite = false;
    const faulted: ImageStore = {
      get: async (key) => {
        if (afterWrite) {
          afterWrite = false;
          throw new Error("injected_readback_loss");
        }
        return image.get(key);
      },
      create: async (...args) => {
        writes++;
        await image.create(...args);
        afterWrite = true;
        throw new Error("injected_upload_response_loss");
      },
      url: (key) => image.url(key),
      accessible: (url, hash) => image.accessible(url, hash),
    };
    try {
      await expect(
        new ResourcePublisher(
          faulted,
          journal,
          capacity,
          async () => {},
          d.image.prefix,
        ).upload(input),
      ).rejects.toThrow("injected_readback_loss");
      expect(writes).toBe(1);
      handle = await manager.restore(d.workspace_id);
      journal = new WorkspaceJournal(manager, handle, id + "-resume");
      const receipt = await new ResourcePublisher(
        image,
        journal,
        capacity,
        async () => {},
        d.image.prefix,
      ).upload(input);
      expect(sha256((await image.get(receipt.object_key))!.content)).toBe(
        receipt.sha256,
      );
      expect(await image.accessible(receipt.url, receipt.sha256)).toBe(true);
      const replay = await new ResourcePublisher(
        image,
        journal,
        capacity,
        async () => {},
        d.image.prefix,
      ).upload(input);
      expect(replay).toEqual(receipt);
      const inventory = await broker();
      const reservations = inventory.reservations.filter(
        (r) => r.reservation_id === sha256(receipt.object_key),
      );
      expect(reservations).toHaveLength(1);
      expect(reservations[0]?.state).toBe("confirmed");
      const logical = inventory.objects.filter(
        (o) => o.bucket === d.image!.bucket && o.key === receipt.object_key,
      );
      expect(logical).toHaveLength(1);
      expect(
        capacityView(inventory.objects, inventory.reservations).verified,
      ).toBe(true);
      // Receipted resource is retained for reference safety; no blind cleanup or commit deletion.
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);

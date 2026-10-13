import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDeployment } from "../../src/config/deployment.js";
import { imageGCFromTrustedHost } from "../../src/publish/image-gc-bootstrap.js";
import { OSSImageGCStore } from "../../src/publish/image-gc-oss.js";
import { MemoryJournal } from "./helpers.js";
const deployment = (name: string) =>
  parseDeployment(
    JSON.parse(
      readFileSync(`agents/reading/deploy/examples/${name}.json`, "utf8"),
    ),
  );
it("GC identity is separately profile-bound; preview and ordinary upload credentials cannot obtain delete capability", async () => {
  const common = {
    journal: new MemoryJournal(),
    records: () => ({}),
    beforeDelete: async () => {},
    afterKeyAbsent: async () => {},
  };
  expect(() =>
    imageGCFromTrustedHost({
      ...common,
      deployment: deployment("preview"),
      credential_reference: "TEST_IMAGE_GC_CREDENTIALS",
    }),
  ).toThrow("Preview");
  expect(() =>
    imageGCFromTrustedHost({
      ...common,
      deployment: deployment("integration"),
      credential_reference: "OSS_TEST_IMAGE_CREDENTIALS",
    }),
  ).toThrow("mismatch");
  expect(
    await imageGCFromTrustedHost({
      ...common,
      deployment: deployment("integration"),
      credential_reference: "TEST_IMAGE_GC_CREDENTIALS",
    })(),
  ).toMatchObject({
    complete: false,
    reason: "dedicated_gc_identity_or_verified_image_binding_missing",
    deleted: [],
  });
});
it("enabled/suspended legacy null versions use explicit versionId=null for GET and DELETE, never create a delete marker by omission", async () => {
  const queries: { method: string; options: unknown }[] = [];
  const client = {
    get: async (_k: string, _f: unknown, options: unknown) => {
      queries.push({ method: "GET", options });
      return {
        content: Buffer.from("x"),
        res: { headers: { "content-type": "image/png" } },
      };
    },
    delete: async (_k: string, options: unknown) => {
      queries.push({ method: "DELETE", options });
    },
  } as unknown as ConstructorParameters<typeof OSSImageGCStore>[0];
  const inventory = {
    inventoryVersions: async () => [
      {
        bucket: "images",
        key: "test/key.png",
        version: "null",
        size: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
  } as unknown as ConstructorParameters<typeof OSSImageGCStore>[1];
  const store = new OSSImageGCStore(client, inventory, "test/", "enabled");
  expect((await store.inventory()).objects[0]?.version_id).toBe(null);
  await store.getVersion("test/key.png", null);
  await store.deleteVersion("test/key.png", null);
  expect(queries).toEqual([
    { method: "GET", options: { timeout: 30000, versionId: "null" } },
    { method: "DELETE", options: { timeout: 30000, versionId: "null" } },
  ]);
  await expect(store.deleteVersion("production/key.png", null)).rejects.toThrow(
    "trusted prefix",
  );
});

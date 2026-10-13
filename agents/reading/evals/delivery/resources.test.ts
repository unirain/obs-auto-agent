import { describe, expect, it } from "vitest";
import {
  ResourcePublisher,
  type ImageStore,
  type ResourceCapacity,
  type ResourceInput,
} from "../../src/publish/resources.js";
import { MemoryJournal } from "./helpers.js";
import type { ResourceReceipt } from "../../src/publish/types.js";
const content = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const input: ResourceInput = {
  project_id: "p1",
  first_generated_date: "2026-10-13",
  article_slug: "mechanisms",
  description: "attention",
  extension: "png",
  mime: "image/png",
  content,
};
class ImageFake implements ImageStore {
  objects = new Map<
    string,
    { content: Uint8Array; mime: string; version_id: null }
  >();
  writes = 0;
  lost = false;
  readFails = false;
  accessibleOK = true;
  async get(key: string) {
    if (this.readFails) throw new Error("read unknown");
    return this.objects.get(key) ?? null;
  }
  async create(key: string, bytes: Uint8Array, mime: string) {
    this.writes++;
    if (this.objects.has(key)) throw new Error("overwrite forbidden");
    this.objects.set(key, { content: bytes, mime, version_id: null });
    if (this.lost) throw new Error("lost response");
  }
  url(key: string) {
    return `https://image.example/${key}`;
  }
  async accessible() {
    return this.accessibleOK;
  }
}
class CapacityFake implements ResourceCapacity {
  reservations = new Map<string, number>();
  receipts = new Map<string, ResourceReceipt>();
  async reserve(id: string, bytes: number) {
    this.reservations.set(id, bytes);
  }
  async confirm(id: string, receipt: ResourceReceipt) {
    this.receipts.set(id, receipt);
    this.reservations.delete(id);
  }
}
describe("immutable resource publisher", () => {
  it("lost response reconciles stable keys without double accounting in next run", async () => {
    const s = new ImageFake(),
      c = new CapacityFake(),
      j = new MemoryJournal();
    s.lost = true;
    s.accessibleOK = false;
    await expect(
      new ResourcePublisher(s, j, c, async () => {}).upload(input),
    ).rejects.toThrow("URL unverified");
    expect(s.writes).toBe(1);
    expect(c.reservations.size).toBe(1);
    s.accessibleOK = true;
    const result = await new ResourcePublisher(s, j, c, async () => {}).upload(
      input,
    );
    expect(result.object_key).toMatch(
      /reading-agent\/p1\/2026-10-13-mechanisms-attention-[a-f0-9]{64}\.png/,
    );
    expect(s.writes).toBe(1);
    expect(c.reservations.size).toBe(0);
    expect(c.receipts.size).toBe(1);
    expect(
      await new ResourcePublisher(s, j, c, async () => {}).upload(input),
    ).toEqual(result);
    expect(s.writes).toBe(1);
    await new ResourcePublisher(s, j, c, async () => {}).upload({
      ...input,
      content: Buffer.concat([content, Buffer.from([9])]),
    });
    expect(s.writes).toBe(2);
    expect(c.receipts.size).toBe(2);
  });
  it("reads and capacity unknown pause without releasing or blind-writing", async () => {
    const s = new ImageFake(),
      c = new CapacityFake(),
      j = new MemoryJournal();
    s.readFails = true;
    await expect(
      new ResourcePublisher(s, j, c, async () => {}).upload(input),
    ).rejects.toThrow("read unknown");
    expect(s.writes).toBe(0);
    expect(c.reservations.size).toBe(1);
    s.readFails = false;
    await new ResourcePublisher(s, j, c, async () => {}).upload(input);
    expect(s.writes).toBe(1);
    const capacity: ResourceCapacity = {
      reserve: async () => {
        throw new Error("capacity unknown");
      },
      confirm: async () => {},
    };
    await expect(
      new ResourcePublisher(
        new ImageFake(),
        new MemoryJournal(),
        capacity,
        async () => {},
      ).upload(input),
    ).rejects.toThrow("capacity unknown");
  });
  it("policy revocation and hash conflicts prevent upload", async () => {
    const s = new ImageFake(),
      j = new MemoryJournal(),
      c = new CapacityFake();
    let checks = 0;
    await expect(
      new ResourcePublisher(s, j, c, async () => {
        if (++checks === 2) throw new Error("revoked");
      }).upload(input),
    ).rejects.toThrow("revoked");
    expect(s.writes).toBe(0);
    expect(c.reservations.size).toBe(1);
    const ok = await new ResourcePublisher(s, j, c, async () => {}).upload(
      input,
    );
    j.data.clear();
    s.objects.get(ok.object_key)!.content = Buffer.from("corrupt");
    await expect(
      new ResourcePublisher(s, j, c, async () => {}).upload(input),
    ).rejects.toThrow("conflict");
    expect(s.writes).toBe(1);
  });
  it("verifies naming, MIME bytes and excludes empty input", async () => {
    for (const bad of [
      { description: "../pwn" },
      { mime: "text/plain" },
      { content: Buffer.from("pwn") },
    ])
      await expect(
        new ResourcePublisher(
          new ImageFake(),
          new MemoryJournal(),
          new CapacityFake(),
          async () => {},
        ).upload({ ...input, ...bad }),
      ).rejects.toThrow();
  });
});

it("definitive IAM denial is sanitized, remains reserved and can retry only after current permission is rechecked", async () => {
  const { OSSImageStore } = await import("../../src/publish/oss-images.js");
  const raw = {
    code: "AccessDenied",
    status: 403,
    message: "secret_should_never_be_persisted",
  };
  const client = {
    get: async () => {
      throw raw;
    },
    put: async () => {
      throw raw;
    },
  } as unknown as ConstructorParameters<typeof OSSImageStore>[0];
  const adapter = new OSSImageStore(
    client,
    "https://image.example",
    "reading-agent/",
  );
  await expect(adapter.get("reading-agent/p1/test.png")).rejects.toThrow(
    "OSS permission denied",
  );
  await expect(
    adapter.create("reading-agent/p1/test.png", content, "image/png"),
  ).rejects.toThrow("OSS permission denied");
  const { AgentError } = await import("../../src/contracts/index.js");
  const s = new ImageFake(),
    j = new MemoryJournal(),
    c = new CapacityFake();
  const denied: ImageStore = {
    ...s,
    get: s.get.bind(s),
    url: s.url.bind(s),
    accessible: s.accessible.bind(s),
    create: async () => {
      throw new AgentError("permission", "OSS permission denied");
    },
  };
  await expect(
    new ResourcePublisher(denied, j, c, async () => {}).upload(input),
  ).rejects.toThrow("permission denied");
  expect(s.writes).toBe(0);
  expect([...j.data.values()][0]).toMatchObject({ status: "reserved" });
  expect(JSON.stringify([...j.data])).not.toContain("secret_should");
  await new ResourcePublisher(s, j, c, async () => {}).upload(input);
  expect(s.writes).toBe(1);
  expect(c.receipts.size).toBe(1);
});

it("a confirmed receipt is rechecked remotely after cleanup or external corruption, never silently reused", async () => {
  const s = new ImageFake(),
    j = new MemoryJournal(),
    c = new CapacityFake();
  const publisher = new ResourcePublisher(s, j, c, async () => {});
  const receipt = await publisher.upload(input);
  s.objects.get(receipt.object_key)!.content = Buffer.from("corrupt");
  await expect(
    new ResourcePublisher(s, j, c, async () => {}).upload(input),
  ).rejects.toThrow("Confirmed image content conflict");
  expect(s.writes).toBe(1);
  s.objects.delete(receipt.object_key);
  await expect(
    new ResourcePublisher(s, j, c, async () => {
      throw new Error("revoked");
    }).upload(input),
  ).rejects.toThrow("revoked");
  expect(s.writes).toBe(1);
  const recreated = await new ResourcePublisher(s, j, c, async () => {}).upload(
    input,
  );
  expect(recreated.object_key).toBe(receipt.object_key);
  expect(s.writes).toBe(2);
});

it("image keys preserve descriptive article/diagram words, including Chinese, without accepting unsafe path syntax", async () => {
  const { resourceNames } = await import("../../src/publish/resources.js");
  const names = resourceNames(
    { title: "有效的 Agent 自动化", url: "https://example.com/automation" },
    "图文件/检查点恢复架构.svg",
    "检查点与恢复",
  );
  expect(names).toEqual({
    article_slug: "有效的-Agent-自动化",
    description: "检查点与恢复",
  });
  const s = new ImageFake(),
    j = new MemoryJournal(),
    c = new CapacityFake();
  const receipt = await new ResourcePublisher(s, j, c, async () => {}).upload({
    ...input,
    ...names,
  });
  expect(receipt.object_key).toContain("有效的-Agent-自动化-检查点与恢复-");
  expect(
    resourceNames(
      { title: "../hidden $(command)", url: "https://example.com/x" },
      "../private/../script.png",
    ).article_slug,
  ).not.toContain("/");
});

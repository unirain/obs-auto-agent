import { it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import {
  canonicalJson,
  sha256,
  type CheckpointResult,
  type InvocationRecord,
} from "../../src/contracts/index.js";
import { registerSchema, validateSchema } from "../../src/contracts/schema.js";
import { registerRecordValidator } from "../../src/contracts/records.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { capacityView, assertCapacity } from "../../src/storage/capacity.js";
import { managedInventory } from "../../src/storage/inventory.js";
import { classifyOssError, OssObjectStore } from "../../src/storage/oss.js";
import { advanceCounters } from "../../src/workspace/counters.js";
import {
  sealPreviewIfReviewPassed,
  verifySeal,
} from "../../src/workspace/seal.js";
import { listAll } from "../../src/storage/preflight.js";
import { encode } from "../../src/workspace/manifest.js";
const ok = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "contracts-audit-"));
  const store = new FileObjectStore(join(root, "remote"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  const h = await manager.restore("obs-notes-hub/reading-preview/audit", {
    allow_initialize: true,
  });
  return { root, store, manager, h };
}
const invocation: InvocationRecord = {
  schema_version: 1,
  invocation_id: "i",
  execution_scope: "preview",
  subject_id: "project:p",
  capability: "research",
  input_hash: sha256("in"),
  context_hash: sha256("ctx"),
  policy_hash: sha256("policy"),
  model: "fixture",
  sdk_version: "fixture",
  status: "prepared",
  messages: [],
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: null,
    cost_status: "unknown",
  },
  limits: { tools: 40 },
};
it("rejects ambiguous or non-JSON serialization before writing any valid checkpoint", async () => {
  const { manager, h, store } = await fixture();
  const cycle: any = {};
  cycle.cycle = cycle;
  const sparse = new Array(2);
  const before = store.calls.length;
  for (const bad of [
    new Date(),
    new Map(),
    cycle,
    sparse,
    { missing: undefined },
    Infinity,
  ]) {
    expect(() => canonicalJson(bad)).toThrow();
    await expect(
      manager.checkpoint(h, {
        expected_revision: h.revision,
        reason: "run_recorded",
        run_id: "run",
        records: { bad: bad as any },
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
  }
  expect(store.calls.filter((call) => call.operation === "create").length).toBe(
    2,
  );
  expect(store.calls.length).toBeGreaterThanOrEqual(before);
  await expect(
    manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "run_recorded",
      run_id: "run",
      event: { type: "unknown_future_event" },
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  const shared = { text: "same" };
  expect(canonicalJson([shared, shared])).toBe(
    '[{"text":"same"},{"text":"same"}]',
  );
});
it("registered business schema restoration rejects a future version in a complete durable chain", async () => {
  registerSchema(
    "eval_contract",
    Type.Object(
      { schema_version: Type.Literal(1), value: Type.String() },
      { additionalProperties: false },
    ),
  );
  registerRecordValidator(
    "eval-contracts/",
    (value) => {
      validateSchema("eval_contract", value);
    },
    (value) => {
      validateSchema("eval_contract", value);
    },
  );
  const { root, store, manager, h } = await fixture();
  const saved = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "run_recorded",
      run_id: "run",
      records: { "eval-contracts/r": { schema_version: 1, value: "old" } },
    }),
  );
  const prefix = manager.prefix(h.workspace_id);
  const bytes = encode({ schema_version: 2, value: "future" });
  const hash = sha256(bytes);
  await store.create(prefix + "blobs/" + hash, bytes);
  const manifest = {
    ...saved.snapshot.manifest,
    revision: "future",
    parent_revision: saved.revision,
    files: [
      {
        ...saved.snapshot.manifest.files[0]!,
        sha256: hash,
        size: bytes.length,
      },
    ],
  };
  const encoded = encode(manifest),
    manifest_key = prefix + "manifests/future.json";
  await store.create(manifest_key, encoded);
  const prior = JSON.parse(
    Buffer.from(await store.read(saved.snapshot.commit_key)).toString("utf8"),
  );
  const sequence = String(BigInt(saved.snapshot.sequence) + 1n).padStart(
    20,
    "0",
  );
  await store.create(
    prefix + "commits/" + sequence + ".json",
    encode({
      ...prior,
      sequence,
      revision: "future",
      manifest_key,
      manifest_sha256: sha256(encoded),
      parent_commit_key: saved.snapshot.commit_key,
      parent_commit_sha256: saved.snapshot.commit_sha256,
    }),
  );
  const restored = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "restart"),
    verify_preflight: false,
  });
  await expect(restored.restore(h.workspace_id)).rejects.toMatchObject({
    code: "corrupt",
  });
});
it("invocation unknown cost and not-started proof are exact, audit cannot be replaced or deleted through raw files", async () => {
  const { root, store, manager, h } = await fixture();
  let saved = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "invocation_prepared",
      run_id: "run",
      records: { "invocations/i": invocation as any },
    }),
  );
  for (const bad of [
    { ...invocation, usage: { ...invocation.usage, cost_status: "known" } },
    { ...invocation, usage: { ...invocation.usage, cost_usd: 0 } },
    { ...invocation, request_started: false },
    {
      ...invocation,
      usage: { ...invocation.usage, input_tokens: Number.MAX_SAFE_INTEGER + 1 },
    },
  ])
    expect(() => validateSchema("invocation", bad)).toThrow();
  await expect(
    manager.checkpoint(saved, {
      expected_revision: saved.revision,
      reason: "invocation_observed",
      run_id: "run",
      files: [
        {
          path: "state/invocations/i.json",
          bytes: encode({ ...invocation, input_hash: sha256("changed") }),
          role: "control",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  await expect(
    manager.checkpoint(saved, {
      expected_revision: saved.revision,
      reason: "maintenance_references_detached",
      run_id: "run",
      remove_paths: ["state/invocations/i.json"],
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  const zero = {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    cost_status: "known" as const,
  };
  const notStarted = {
    ...invocation,
    status: "running" as const,
    request_started: false,
    messages: [{ message_id: "not_started_i", summary: true, usage: zero }],
    usage: zero,
  };
  saved = ok(
    await manager.checkpoint(saved, {
      expected_revision: saved.revision,
      reason: "invocation_observed",
      run_id: "run",
      records: { "invocations/i": notStarted as any },
    }),
  );
  const next = new ImmutableWorkspaceManager({
    store: new FileObjectStore(store.root),
    scope: "preview",
    local_root: join(root, "next"),
    verify_preflight: false,
  });
  expect((await next.restore(h.workspace_id)).records["invocations/i"]).toEqual(
    notStarted,
  );
  await expect(
    manager.checkpoint(saved, {
      expected_revision: saved.revision,
      reason: "invocation_finished",
      run_id: "run",
      records: {
        "invocations/i": {
          ...notStarted,
          status: "failed",
          request_started: true,
        } as any,
      },
    }),
  ).rejects.toMatchObject({ code: "corrupt" });
  await expect(store.delete(saved.snapshot.commit_key)).rejects.toMatchObject({
    code: "permission",
  });
});
it("inventory treats legacy null once, rejects corrupt metadata and unknown pagination", async () => {
  const object = {
    bucket: "b",
    key: "k",
    size: 3,
    created_at: "2026-10-13T00:00:00Z",
  };
  const objects = [object, { ...object, version: "null" }];
  expect(capacityView(objects, []).occupied_bytes).toBe(3);
  expect(() =>
    assertCapacity(
      { ...capacityView([], []), limit_bytes: 100_000_000_000 },
      1,
      "generation",
    ),
  ).toThrow();
  expect(() =>
    assertCapacity(
      { ...capacityView([], []), occupied_bytes: 49_000_000_000 },
      0,
      "generation",
    ),
  ).toThrow();
  const inventory = await managedInventory(
    [],
    [{ inventory: async () => ({ complete: true, objects }) }],
  );
  expect(inventory).toHaveLength(1);
  for (const bad of [
    { ...object, size: -1 },
    { ...object, size: NaN },
    { ...object, created_at: "unknown" },
    { ...object, bucket: "" },
  ])
    expect(() => capacityView([bad], [])).toThrow();
  expect(() => capacityView([object, { ...object, size: 4 }], [])).toThrow();
  const { store } = await fixture();
  store.list = async () => ({ objects: [], next_cursor: undefined }) as any;
  await expect(listAll(store, "prefix/")).rejects.toMatchObject({
    code: "corrupt",
  });
  for (const error of [null, undefined, "timeout"])
    expect(classifyOssError(error).code).toBe("unknown");
  expect(
    () =>
      new OssObjectStore({
        bucket: "b",
        region: "oss-cn-beijing",
        endpoint: "https://user@oss-cn-beijing.aliyuncs.com",
        accessKeyId: "test",
        accessKeySecret: "test",
      }),
  ).toThrow();
});
it("seal version and full artifact set cannot be forged even with a recomputed hash; counters reject overflow", async () => {
  const { manager, h } = await fixture();
  const saved = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "render_artifact",
      run_id: "run",
      files: [
        {
          path: "projects/p/draft/note.md",
          bytes: Buffer.from("note"),
          role: "artifact",
          project_id: "p",
        },
      ],
    }),
  );
  const seal = (await sealPreviewIfReviewPassed(saved, "p", {
    review_passed: true,
    program_checks_passed: true,
    input_revision: saved.revision,
    resources: [],
  }))!;
  for (const bad of [
    { ...seal, schema_version: 2 },
    { ...seal, files: [] },
    { ...seal, publish_checks: "passed" },
  ]) {
    const { validated_hash: _, ...body } = bad;
    await expect(
      verifySeal(saved, {
        ...bad,
        validated_hash: sha256(canonicalJson(body)),
      } as any),
    ).rejects.toMatchObject({ code: "corrupt" });
  }
  const counters = {
    batch_id: "b",
    tools: 0,
    materials: 0,
    classifications: 0,
    revisions: 0,
    no_progress: 0,
    total_tools: Number.MAX_SAFE_INTEGER,
    total_materials: 0,
    yield_revision: null,
  };
  expect(() => advanceCounters(counters, { tools: 1 })).toThrow();
});

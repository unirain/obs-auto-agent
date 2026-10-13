import { readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { Ajv } from "ajv";
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  UtcInstantSchema,
  isUtcInstant,
  assertUtcInstant,
} from "../../src/contracts/utc.js";
import {
  SHARED_SCHEMA_DOCUMENTS,
  registerSchema,
  validateSchema,
} from "../../src/contracts/schema.js";
import {
  registerTransition,
  validateChange,
} from "../../src/contracts/transitions.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import {
  canonicalJson,
  type CheckpointResult,
} from "../../src/contracts/index.js";
const valid = [
  "2026-10-13T00:00:00Z",
  "2026-10-13T00:00:00.1Z",
  "2026-10-13T00:00:00.12Z",
  "2026-10-13T00:00:00.123Z",
  "2000-02-29T23:59:59Z",
  "2024-02-29T00:00:00Z",
  "2400-02-29T00:00:00Z",
  "0000-02-29T00:00:00Z",
];
const invalid: unknown[] = [
  "2026-10-13T00:00:00Z\n",
  "2026-10-13T00:00:00Z\r\n",
  "2026-10-13T00:00:00Z\u0000",
  "2026-10-13",
  "2026-10-13T00:00:00",
  "2026-10-13T00:00:00+00:00",
  "2026-10-13T08:00:00+08:00",
  "2026-02-29T00:00:00Z",
  "1900-02-29T00:00:00Z",
  "2100-02-29T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-02-30T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-10-00T00:00:00Z",
  "2026-10-13T24:00:00Z",
  "2026-10-13T00:60:00Z",
  "2026-10-13T00:00:60Z",
  "2026-10-13T00:00:00.Z",
  "2026-10-13T00:00:00.1234Z",
  "2026-10-13T00:00:00z",
  NaN,
  Infinity,
  null,
  undefined,
  new Date("2026-10-13T00:00:00Z"),
  "not-a-time",
];
const ok = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
it("UTC primitive, TypeBox and portable JSON schema accept second/millisecond precision and reject invalid calendars without conversion", () => {
  const typebox = TypeCompiler.Compile(UtcInstantSchema),
    ajv = new Ajv({ strict: true }),
    json = ajv.compile(JSON.parse(JSON.stringify(UtcInstantSchema)));
  for (const value of valid) {
    expect(isUtcInstant(value), value).toBe(true);
    expect(typebox.Check(value), value).toBe(true);
    expect(json(value), value).toBe(true);
    expect(() => assertUtcInstant(value)).not.toThrow();
  }
  for (const value of invalid) {
    expect(isUtcInstant(value), String(value)).toBe(false);
    expect(typebox.Check(value), String(value)).toBe(false);
    expect(json(value), String(value)).toBe(false);
    expect(() => assertUtcInstant(value)).toThrow();
  }
  // Daily note dates are separate data; the UTC instant guard must not convert them.
  expect(isUtcInstant("2026-10-13")).toBe(false);
});
it("every shared checked-in JSON schema exactly matches the single source/registration table", async () => {
  expect(new Set(SHARED_SCHEMA_DOCUMENTS.map((entry) => entry.name)).size).toBe(
    SHARED_SCHEMA_DOCUMENTS.length,
  );
  expect(new Set(SHARED_SCHEMA_DOCUMENTS.map((entry) => entry.file)).size).toBe(
    SHARED_SCHEMA_DOCUMENTS.length,
  );
  for (const { file, schema } of SHARED_SCHEMA_DOCUMENTS) {
    const document = JSON.parse(
      await readFile(join("agents/reading/schemas", file), "utf8"),
    );
    expect(canonicalJson(document), file).toBe(
      canonicalJson(JSON.parse(JSON.stringify(schema))),
    );
  }
});
it("schema and transition registrations reject duplicates without replacing the first rule, and unknown lookup/event rejects", async () => {
  const name = "utc_registry_contract";
  registerSchema(name, Type.Literal("first"));
  expect(validateSchema(name, "first")).toBe("first");
  expect(() => registerSchema(name, Type.Literal("replaced"))).toThrow();
  expect(() => validateSchema(name, "replaced")).toThrow();
  expect(() => validateSchema("unknown_schema", {})).toThrow();
  const root = await mkdtemp(join(tmpdir(), "transition-registry-"));
  const store = new FileObjectStore(join(root, "objects"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  const h = await manager.restore("obs-notes-hub/reading-preview/utc", {
    allow_initialize: true,
  });
  registerTransition("registered_utc_event", (_handle, change) => {
    if (change.reason !== "admitted") throw new Error("original_rule_rejected");
  });
  expect(() => registerTransition("registered_utc_event", () => {})).toThrow();
  const change = {
    expected_revision: h.revision,
    run_id: "r",
    reason: "admitted",
    event: { type: "registered_utc_event" },
  };
  expect(() => validateChange(h, change)).not.toThrow();
  expect(() => validateChange(h, { ...change, reason: "replaced" })).toThrow(
    "original_rule_rejected",
  );
  expect(() =>
    validateChange(h, { ...change, event: { type: "future_event" } }),
  ).toThrow();
});
it("a new FileStore run retains exact UTC metadata and refuses non-UTC persistence rather than normalizing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "utc-persistence-"));
  const store = new FileObjectStore(join(root, "remote"));
  const options = {
    store,
    scope: "preview" as const,
    local_root: join(root, "first"),
    verify_preflight: false,
  };
  const manager = new ImmutableWorkspaceManager(options);
  let h = await manager.restore("obs-notes-hub/reading-preview/utc", {
    allow_initialize: true,
  });
  const value = { run_id: "r", started_at: "2026-10-13T00:00:00.12Z" };
  h = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      run_id: "r",
      reason: "invocation_prepared",
      records: { "invocation_meta/i": value },
    }),
  );
  const before = store.calls.filter(
    (call) => call.operation === "create",
  ).length;
  for (const started_at of [
    "2026-10-13",
    "2026-10-13T00:00:00+00:00",
    "2026-02-30T00:00:00Z",
  ])
    await expect(
      manager.checkpoint(h, {
        expected_revision: h.revision,
        run_id: "next",
        reason: "invocation_observed",
        records: { "invocation_meta/i": { ...value, started_at } },
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
  expect(
    store.calls.filter((call) => call.operation === "create"),
  ).toHaveLength(before);
  const cold = new ImmutableWorkspaceManager({
    ...options,
    store: new FileObjectStore(store.root),
    local_root: join(root, "cold"),
  });
  expect(
    (await cold.restore(h.workspace_id)).records["invocation_meta/i"],
  ).toEqual(value);
  const manifest = h.snapshot.manifest;
  expect(validateSchema("workspace", manifest)).toEqual(manifest);
  for (const created_at of ["2026-04-31T00:00:00Z", "2026-10-13"])
    expect(() =>
      validateSchema("workspace", { ...manifest, created_at }),
    ).toThrow();
  const capacity = {
    verified: true,
    observed_at: "2026-10-13T00:00:00Z",
    occupied_bytes: 0,
    reserved_bytes: 0,
    limit_bytes: 50_000_000_000,
    warning: false,
    accepts_generation: true,
  };
  expect(validateSchema("storage", capacity)).toEqual(capacity);
  expect(() =>
    validateSchema("storage", {
      ...capacity,
      observed_at: "2026-10-13T00:00:00+00:00",
    }),
  ).toThrow();
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseDeployment,
  executionTarget,
  credentialReferences,
  assertWorkspaceReady,
} from "../../src/config/deployment.js";
import { parseDispatch, dailyLogicalKey } from "../../src/config/dispatch.js";
const config = (name: string) =>
  JSON.parse(
    readFileSync(`agents/reading/deploy/examples/${name}.json`, "utf8"),
  ) as Record<string, unknown>;
describe("trusted deployment and dispatch", () => {
  it("manual defaults preview; four modes reject scope crossings and new URLs on resume", () => {
    expect(
      parseDispatch({ input_urls: '["https://example.com/old"]' }).mode,
    ).toBe("preview");
    expect(
      parseDispatch({
        mode: "scheduled",
        input_urls: ["https://example.com/old"],
      }).input_urls,
    ).toEqual(["https://example.com/old"]);
    for (const mode of ["resume", "publish-only"])
      expect(() =>
        parseDispatch({
          mode,
          project_id: "p1",
          input_urls: ["https://example.com/x"],
        }),
      ).toThrow();
    expect(() =>
      parseDispatch({ mode: "publish-only", preview_id: "p1" }),
    ).toThrow();
    expect(() =>
      parseDispatch({
        mode: "preview",
        project_id: "p1",
        input_urls: ["https://example.com/x"],
      }),
    ).toThrow();
    expect(() =>
      parseDispatch({ input_urls: ["https://example.com/x"] }, "schedule"),
    ).toThrow();
    expect(parseDispatch({}, "schedule").mode).toBe("scheduled");
  });
  it("JSON shell characters remain data, never interpolation; malicious URLs rejected", () => {
    const u = "https://example.com/$(touch%20/tmp/pwn)?q=%60uname%60";
    expect(
      parseDispatch({ input_urls: JSON.stringify([u]) }).input_urls,
    ).toEqual([u]);
    for (const urls of [
      '["x"',
      '"https://example.com"',
      "[1]",
      '["file:///etc/passwd"]',
      '["https://user:secret@example.com/"]',
      '["http://127.0.0.1/"]',
    ])
      expect(() => parseDispatch({ input_urls: urls })).toThrow();
  });
  it("preview capabilities remain absent even if a production manifest is forged", () => {
    const p = parseDeployment(config("preview"));
    const t = executionTarget(
      p,
      parseDispatch({ input_urls: ["https://example.com/x"] }),
    );
    expect(t.execution_scope).toBe("preview");
    expect(credentialReferences(t, "workspace")).toEqual([
      "OSS_PREVIEW_CREDENTIALS",
    ]);
    for (const role of ["publisher", "image", "watchdog"] as const)
      expect(() => credentialReferences(t, role)).toThrow();
    expect(() =>
      executionTarget(p, parseDispatch({ mode: "scheduled" })),
    ).toThrow();
    expect(() =>
      parseDeployment({
        ...config("preview"),
        image: config("production").image,
      }),
    ).toThrow();
    expect(() =>
      parseDeployment({ ...config("preview"), execution_scope: "production" }),
    ).toThrow();
  });
  it("binds production and isolated integration targets; unverified OSS stops live startup", () => {
    const prod = parseDeployment(config("production"));
    expect(() => assertWorkspaceReady(prod)).toThrow("unverified");
    expect(() =>
      parseDeployment({
        ...config("production"),
        target_repository: "attacker/notes",
      }),
    ).toThrow();
    expect(() =>
      parseDeployment({
        ...config("integration"),
        target_repository: "unirain/obs-notes-hub",
      }),
    ).toThrow();
    const preview = config("preview");
    const workspace = preview.workspace as Record<string, unknown>;
    expect(() =>
      parseDeployment({
        ...preview,
        workspace: {
          ...workspace,
          endpoint: "oss-cn-beijing-internal.aliyuncs.com",
        },
      }),
    ).toThrow();
    expect(() =>
      parseDeployment({
        ...preview,
        workspace: { ...workspace, versioning_verified: "enabled" },
      }),
    ).toThrow();
    expect(() =>
      parseDeployment({ ...config("production"), cron_enabled: true }),
    ).toThrow("G5");
    expect(() =>
      parseDeployment({ ...config("production"), accessKeySecret: "secret" }),
    ).toThrow();
  });
  it("uses Shanghai date and does not conflate daily key with submission identity", () => {
    expect(dailyLogicalKey(new Date("2026-10-12T20:00:00Z"))).toBe(
      "2026-10-13",
    );
    expect(
      parseDispatch({
        mode: "scheduled",
        input_urls: ["https://example.com/new"],
        submission_id: "new-input",
      }).submission_id,
    ).toBe("new-input");
  });
});

it("model provider endpoints are fixed trusted Anthropic-compatible hosts, never arbitrary exfil destinations", () => {
  const d = config("preview");
  expect(() =>
    parseDeployment({
      ...d,
      model_provider: "deepseek",
      model_base_url: "https://attacker.example/anthropic",
    }),
  ).toThrow("Untrusted");
  expect(() =>
    parseDeployment({
      ...d,
      model_provider: "claude",
      model_base_url: "https://api.deepseek.com/anthropic",
    }),
  ).toThrow("Untrusted");
  expect(() =>
    parseDeployment({
      ...d,
      model_provider: "deepseek",
      model_base_url: undefined,
    }),
  ).toThrow("Untrusted");
  expect(
    parseDeployment({
      ...d,
      model_provider: "claude",
      model_base_url: "https://api.anthropic.com",
    }).model_provider,
  ).toBe("claude");
});

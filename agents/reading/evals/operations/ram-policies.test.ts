import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createRAMPolicies,
  DEFAULT_RAM_BINDINGS,
  type RAMPolicy,
} from "../../deploy/ram/generate.js";
const policies = createRAMPolicies(DEFAULT_RAM_BINDINGS);
it("all checked-in RAM templates reproduce from precise nonsecret deployment bindings", () => {
  for (const [name, value] of Object.entries(policies))
    expect(
      JSON.parse(
        readFileSync(`agents/reading/deploy/ram/${name}.json`, "utf8"),
      ),
    ).toEqual(value);
  for (const profile of ["production", "preview", "integration"]) {
    const d = JSON.parse(
      readFileSync(`agents/reading/deploy/examples/${profile}.json`, "utf8"),
    );
    expect(d.workspace.bucket).toBe(DEFAULT_RAM_BINDINGS.workspace_bucket);
    expect(d.workspace.prefix).toBe(
      profile === "production"
        ? DEFAULT_RAM_BINDINGS.production_prefix
        : profile === "preview"
          ? DEFAULT_RAM_BINDINGS.preview_prefix
          : DEFAULT_RAM_BINDINGS.integration_prefix,
    );
    if (profile === "integration")
      expect(d.image.prefix).toBe(DEFAULT_RAM_BINDINGS.image_prefix);
  }
});
it("uses bucket resources for list/config and prefix conditions; object writes stay in own scope", () => {
  for (const policy of Object.values(policies))
    for (const stmt of policy.Statement) {
      expect(stmt.Action).not.toContain("oss:*");
      if (stmt.Action.includes("oss:ListObjects")) {
        expect(stmt.Resource.every((r) => !r.includes("/"))).toBe(true);
        expect(stmt.Condition?.StringLike["oss:Prefix"].length).toBeGreaterThan(
          0,
        );
      }
      if (stmt.Action.includes("oss:PutObject"))
        expect(
          stmt.Resource.every((r) => r.includes("/") && r.endsWith("/*")),
        ).toBe(true);
    }
  for (const name of ["preview-workspace", "test-workspace"]) {
    const writer = policies[name] as RAMPolicy;
    expect(
      writer.Statement.some(
        (s) =>
          s.Effect === "Deny" &&
          s.Action.includes("oss:DeleteObject") &&
          s.Resource.some((r) => r.endsWith("/commits/*")),
      ),
    ).toBe(true);
    expect(JSON.stringify(writer)).not.toContain("reading/production/");
  }
  for (const name of ["capacity-readonly", "test-watchdog-readonly"])
    expect(
      policies[name]?.Statement.filter((s) => s.Effect === "Allow").flatMap(
        (s) => s.Action,
      ),
    ).not.toContain("oss:PutObject");
  expect(
    policies["capacity-readonly"]?.Statement.some((s) =>
      s.Action.includes("oss:ListObjectVersions"),
    ),
  ).toBe(true);
});
it("rejects unsafe buckets/prefixes before writing any local policy", () => {
  expect(() =>
    createRAMPolicies({ ...DEFAULT_RAM_BINDINGS, workspace_bucket: "*" }),
  ).toThrow();
  expect(() =>
    createRAMPolicies({
      ...DEFAULT_RAM_BINDINGS,
      integration_prefix: "reading/*/",
    }),
  ).toThrow();
  expect(() =>
    createRAMPolicies({ ...DEFAULT_RAM_BINDINGS, image_prefix: "../images/" }),
  ).toThrow();
});

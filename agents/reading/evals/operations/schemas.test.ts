import { it, expect } from "vitest";
import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { sealed } from "../delivery/helpers.js";
import { projectEvents } from "../../src/monitor/source-health.js";
const ajv = new Ajv({ allErrors: true });
const check = (name: string, value: unknown) => {
  const schema = JSON.parse(
    readFileSync(`agents/reading/schemas/${name}.schema.json`, "utf8"),
  );
  return ((schema.$id?ajv.getSchema(schema.$id):undefined) ?? ajv.compile(schema))(value);
};
it("public schemas agree with deployment, encoded delivery, resource and projection DTOs", () => {
  for (const profile of ["production", "preview", "integration"])
    expect(
      check(
        "deployment",
        JSON.parse(
          readFileSync(
            `agents/reading/deploy/examples/${profile}.json`,
            "utf8",
          ),
        ),
      ),
    ).toBe(true);
  const d = sealed();
  expect(
    check("delivery", {
      ...d,
      files: d.files.map(({ content, ...f }) => ({
        ...f,
        content_base64: Buffer.from(content).toString("base64"),
      })),
    }),
  ).toBe(true);
  const metadata = projectEvents(
    [
      {
        event_id: "e1",
        position: 1,
        workspace_id: d.workspace_id,
        execution_scope: "production",
        source_id: "a",
        reason_code: "fetch_failed",
        kind: "occurred",
        occurred_at: "2026-10-13T00:00:00Z",
      },
    ],
    undefined,
    false,
  )!.metadata;
  expect(check("monitor-metadata", metadata)).toBe(true);
  expect(check("monitor-metadata", { ...metadata, last_position: -1 })).toBe(
    false,
  );
  const receipt = {
    object_key: "reading-agent/p/" + "a".repeat(64) + ".png",
    sha256: "a".repeat(64),
    bytes: 1,
    mime: "image/png",
    url: "https://image.example/a.png",
    project_id: "p",
    version_id: null,
    confirmed_at: "2026-10-13T00:00:00Z",
  };
  expect(check("resource-receipt", receipt)).toBe(true);
  expect(check("resource-receipt", { ...receipt, sha256: "invented" })).toBe(
    false,
  );
});

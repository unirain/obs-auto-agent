import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parseDeployment } from "../../src/config/deployment.js";
import { capacityBrokerFromEnvironment } from "../../src/storage/broker.js";
it("capacity broker requires explicit all-scope bindings and never falls back to account credential file", async () => {
  const deployment = parseDeployment(
    JSON.parse(
      await readFile("agents/reading/deploy/examples/preview.json", "utf8"),
    ),
  );
  expect(() =>
    capacityBrokerFromEnvironment(
      { OSS_CREDENTIALS_FILE: "/unread/credential/file" },
      deployment,
    ),
  ).toThrow("capacity_broker_credentials_unconfigured");
  const workspace = {
    kind: "workspace",
    bucket: deployment.workspace.bucket,
    region: deployment.workspace.region,
    endpoint: deployment.workspace.endpoint,
  };
  const common = { accessKeyId: "test-id", accessKeySecret: "test-secret" };
  expect(() =>
    capacityBrokerFromEnvironment(
      {
        READING_CAPACITY_VIEW_CREDENTIALS: JSON.stringify({
          ...common,
          bindings: [
            {
              ...workspace,
              scope: "preview",
              prefix: deployment.workspace.prefix,
            },
          ],
          image_inventory: "none_managed_verified",
        }),
      },
      deployment,
    ),
  ).toThrow("capacity_all_workspace_scopes_required");
  const bindings = [
    { ...workspace, scope: "production", prefix: "workspaces/production/" },
    { ...workspace, scope: "preview", prefix: deployment.workspace.prefix },
  ];
  expect(() =>
    capacityBrokerFromEnvironment(
      {
        READING_CAPACITY_VIEW_CREDENTIALS: JSON.stringify({
          ...common,
          bindings,
        }),
      },
      deployment,
    ),
  ).toThrow("capacity_image_inventory_required");
  expect(
    typeof capacityBrokerFromEnvironment(
      {
        READING_CAPACITY_VIEW_CREDENTIALS: JSON.stringify({
          ...common,
          bindings,
          image_inventory: "none_managed_verified",
        }),
      },
      deployment,
    ),
  ).toBe("function");
});

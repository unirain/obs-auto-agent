import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import {
  readonlyObjectStore,
  readMonitorProjection,
  runWatchdogApplication,
} from "../../src/app/watchdog.js";
import { parseDeployment } from "../../src/config/deployment.js";
import { sha256 } from "../../src/contracts/index.js";
const deployment = () =>
  parseDeployment(
    JSON.parse(
      readFileSync("agents/reading/deploy/examples/integration.json", "utf8"),
    ),
  );
it("watchdog validates HEAD chain and reads only committed health/reports, never original evidence or writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "watchdog-reader-"));
  const d = deployment();
  const store = new FileObjectStore(join(dir, "objects"), 1, {
    versioning: "never",
    acl: "private",
    endpoint: "https://oss-cn-beijing.aliyuncs.com",
    lifecycle: [],
    anonymous_readable: false,
  });
  try {
    const manager = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      trusted_workspace_id: d.workspace_id,
      local_root: join(dir, "local"),
      prefix: d.workspace.prefix.replace(/\/$/, ""),
    });
    const initial = await manager.restore(d.workspace_id, {
      allow_initialize: true,
    });
    const evidence = Buffer.from("private source never fetched by watchdog");
    const result = await manager.checkpoint(initial, {
      expected_revision: initial.revision,
      run_id: "r1",
      reason: "monitor_fixture",
      records: {
        "sources/health": {
          schema_version: 1,
          events: [
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
        },
        "runs/42": {
          schema_version: 1,
          run_id: "42",
          workspace_id: d.workspace_id,
          execution_scope: "production",
          mode: "scheduled",
          finished_at: "2026-10-13T01:00:00Z",
          failures: [{ subject: "p1", reason: "capacity_unknown" }],
        },
      },
      files: [
        {
          path: "projects/p1/sources/private.txt",
          bytes: evidence,
          role: "evidence",
          project_id: "p1",
        },
      ],
    });
    expect(result.status).toBe("committed");
    store.calls.length = 0;
    const projection = await readMonitorProjection(
      readonlyObjectStore(store),
      d,
    );
    expect(projection.events).toHaveLength(2);
    expect(projection.events[1]?.reason_code).toBe("capacity_paused");
    expect(projection.reportIds.has("42")).toBe(true);
    expect(
      store.calls.some((c) => c.key.endsWith("/blobs/" + sha256(evidence))),
    ).toBe(false);
    expect(
      store.calls.every((c) => !["create", "delete"].includes(c.operation)),
    ).toBe(true);
    await expect(
      readonlyObjectStore(store).create("x", Buffer.from("x")),
    ).rejects.toThrow("cannot write");
    await expect(readonlyObjectStore(store).delete("x")).rejects.toThrow(
      "cannot delete",
    );
    store.faults.push({
      operation: "read",
      key: result.status === "committed" ? result.snapshot.manifest_key : "",
      kind: "corrupt",
    });
    await expect(
      readMonitorProjection(readonlyObjectStore(store), d),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("unactivated watchdog is explicitly disabled without loading any secret or SDK", async () => {
  expect(
    await runWatchdogApplication({ deployment: deployment(), env: {} }),
  ).toEqual({
    status: "disabled",
    reason: "monitoring_has_no_activation_time",
  });
});

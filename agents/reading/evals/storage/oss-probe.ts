import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadOssCredentials } from "../../src/config/credentials.js";
import { OssObjectStore } from "../../src/storage/oss.js";
import { preflight, listAll } from "../../src/storage/preflight.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import {
  AgentError,
  sha256,
  type ObjectStore,
} from "../../src/contracts/index.js";
export interface ProbeReport {
  sdk_version: string;
  region: string;
  private: boolean;
  versioning: string;
  lifecycle_safe: boolean;
  results: Record<string, string>;
  test_prefix: string;
  created_at: string;
}
export async function runOssProbe(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProbeReport> {
  if (env.OSS_LIVE_TEST_ALLOWED !== "isolated-existing-bucket")
    throw new AgentError("configuration", "Live isolated test opt-in required");
  const bucket = env.OSS_TEST_BUCKET;
  if (!bucket)
    throw new AgentError(
      "configuration",
      "Explicit existing test bucket required",
    );
  const prefix = `reading-agent-tests/${randomUUID()}/`;
  const credentials = await loadOssCredentials(env);
  const store = new OssObjectStore({
    bucket,
    region: env.OSS_TEST_REGION ?? "oss-cn-beijing",
    endpoint: env.OSS_TEST_ENDPOINT ?? "https://oss-cn-beijing.aliyuncs.com",
    ...credentials,
    allowed_prefix: prefix,
    page_size: 1,
  });
  const config = await store.configuration();
  await preflight(store);
  const report: ProbeReport = {
    sdk_version: "ali-oss@6.23.0",
    region: env.OSS_TEST_REGION ?? "oss-cn-beijing",
    private: config.acl === "private" && !config.anonymous_readable,
    versioning: config.versioning,
    lifecycle_safe: !config.lifecycle.some((r) => r.expires),
    test_prefix: prefix,
    created_at: new Date().toISOString(),
    results: {},
  };
  const body = Buffer.from("isolated protocol contract");
  const key = prefix + "contracts/race";
  const race = await Promise.allSettled([
    store.create(key, body),
    store.create(key, Buffer.from("other")),
  ]);
  if (
    race.filter((r) => r.status === "fulfilled").length !== 1 ||
    !race.some(
      (r) =>
        r.status === "rejected" &&
        r.reason instanceof AgentError &&
        r.reason.code === "conflict",
    )
  )
    throw new AgentError("corrupt", "OSS no-overwrite race contract failed");
  report.results.immutable_race = "passed";
  report.results.forbid_overwrite_header = "behavior_verified";
  await store.create(prefix + "contracts/page-two", body);
  const page = await store.list(prefix + "contracts/");
  if (!page.next_cursor)
    throw new AgentError("corrupt", "Expected multiple list pages");
  const all = await listAll(store, prefix + "contracts/");
  if (all.length !== 2)
    throw new AgentError("corrupt", "Complete pagination failed");
  report.results.pagination = "passed";
  const existing = all[0]!;
  const anonymous = await fetch(
    `https://${bucket}.${new URL(config.endpoint).hostname}/${existing.key}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (anonymous.ok)
    throw new AgentError(
      "configuration",
      "Private test object anonymously readable",
    );
  report.results.anonymous_read =
    anonymous.status === 403 ? "denied" : "not_verified";
  try {
    await store.read(prefix + "missing");
    throw new AgentError("corrupt", "Missing object returned");
  } catch (e) {
    if (!(e instanceof AgentError) || e.code !== "not_found") throw e;
  }
  report.results.explicit_missing = "passed";
  let lost = false;
  const loss: ObjectStore = {
    bucket: store.bucket,
    configuration: () => store.configuration(),
    stat: (k) => store.stat(k),
    list: (p, c) => store.list(p, c),
    read: (k) => store.read(k),
    delete: (k) => store.delete(k),
    create: async (k, b) => {
      await store.create(k, b);
      if (k.includes("/commits/") && !lost) {
        lost = true;
        throw new AgentError("unknown", "Controlled post-response loss");
      }
    },
  };
  const root = await mkdtemp(join(tmpdir(), "oss-live-probe-"));
  const manager = new ImmutableWorkspaceManager({
    store: loss,
    scope: "preview",
    local_root: root,
    prefix: prefix + "workspaces",
  });
  const id = "obs-notes-hub/reading-preview/probe";
  let handle = await manager.restore(id, {
    allow_initialize: true,
    run_id: "oss-probe",
  });
  const result = await manager.checkpoint(handle, {
    expected_revision: handle.revision,
    reason: "contract_probe",
    run_id: "oss-probe",
    records: { probe: { sha256: sha256(body) } },
  });
  if (result.status !== "committed")
    throw new AgentError("corrupt", "Live checkpoint failed");
  handle = result.handle;
  const fresh = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: root + "-fresh",
    prefix: prefix + "workspaces",
  });
  if ((await fresh.restore(id)).revision !== handle.revision)
    throw new AgentError("corrupt", "Live restore mismatched");
  report.results.immutable_chain = "passed";
  report.results.response_loss_reconciliation =
    "passed_controlled_adapter_fault";
  report.results.network_response_loss = "live_unverified";
  report.results.ram_isolation = "live_unverified_separate_identities_required";
  if (env.OSS_TEST_REPORT_PATH)
    await writeFile(
      env.OSS_TEST_REPORT_PATH,
      JSON.stringify(report, null, 2) + "\n",
    );
  return report;
}
if (process.argv[1]?.endsWith("/oss-probe.ts")) {
  runOssProbe()
    .then((report) => {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    })
    .catch((e) => {
      process.stderr.write(
        JSON.stringify({
          status: "failed",
          category: e instanceof AgentError ? e.code : "configuration",
        }) + "\n",
      );
      process.exitCode = 1;
    });
}

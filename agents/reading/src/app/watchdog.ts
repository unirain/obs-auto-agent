import { Octokit } from "@octokit/rest";
import { parseDeployment, type Deployment } from "../config/deployment.js";
import {
  GitHubPolicySource,
  parseTrustedPolicy,
  type PolicySource,
} from "../config/trusted-policy.js";
import { OssObjectStore } from "../storage/oss.js";
import { listAll, preflight } from "../storage/preflight.js";
import {
  AgentError,
  sha256,
  type ObjectStore,
  type CommitRecord,
  type WorkspaceManifest,
} from "../contracts/index.js";
import {
  decode,
  validateCommit,
  validateManifest,
  assertBytes,
} from "../workspace/manifest.js";
import { IssueProjector, OctokitIssuePort } from "../monitor/issues.js";
import { runWatchdog } from "../monitor/main.js";
import type { SourceEvent, SourceHealth } from "../collect/incidents.js";
import { createGitHubAppClient, parseAppCredentials } from "../publish/auth.js";
import type { RunReport } from "./controller.js";
export function readonlyObjectStore(store: ObjectStore): ObjectStore {
  return {
    bucket: store.bucket,
    read: (key) => store.read(key),
    stat: (key) => store.stat(key),
    list: (prefix, cursor) => store.list(prefix, cursor),
    configuration: () => store.configuration(),
    create: async () => {
      throw new AgentError("permission", "Watchdog cannot write workspace");
    },
    delete: async () => {
      throw new AgentError("permission", "Watchdog cannot delete workspace");
    },
  };
}
/** Validate commit metadata first, then read only source-health/report blobs from the authoritative HEAD. */
export async function readMonitorProjection(
  store: ObjectStore,
  deployment: Deployment,
): Promise<{ events: SourceEvent[]; reportIds: Set<string> }> {
  await preflight(store);
  const prefix = `${deployment.workspace.prefix}${deployment.workspace_id}/`;
  const commits = await listAll(store, prefix + "commits/");
  if (!commits.length)
    throw new AgentError("not_found", "No initialized workspace report chain");
  let previous: CommitRecord | null = null;
  let previousKey: string | null = null;
  let previousHash: string | null = null;
  let head: CommitRecord | null = null;
  for (let i = 0; i < commits.length; i++) {
    const sequence = BigInt(i).toString().padStart(20, "0");
    const key = `${prefix}commits/${sequence}.json`;
    if (commits[i]?.key !== key)
      throw new AgentError("corrupt", "Monitor commit sequence gap");
    const bytes = await store.read(key);
    const commit = decode<CommitRecord>(bytes, "checkpoint");
    validateCommit(commit);
    if (
      commit.sequence !== sequence ||
      commit.workspace_id !== deployment.workspace_id ||
      commit.execution_scope !== deployment.execution_scope ||
      commit.parent_commit_key !== previousKey ||
      commit.parent_commit_sha256 !== previousHash ||
      commit.manifest_key !== `${prefix}manifests/${commit.revision}.json`
    )
      throw new AgentError("corrupt", "Monitor commit chain mismatch");
    previousKey = key;
    previousHash = sha256(bytes);
    previous = head;
    head = commit;
  }
  if (!head) throw new AgentError("corrupt", "Monitor missing HEAD");
  const bytes = await store.read(head.manifest_key);
  assertBytes(bytes, head.manifest_sha256);
  const manifest = decode<WorkspaceManifest>(bytes, "workspace");
  validateManifest(manifest);
  if (
    manifest.workspace_id !== deployment.workspace_id ||
    manifest.execution_scope !== deployment.execution_scope ||
    manifest.revision !== head.revision ||
    manifest.parent_revision !== (previous?.revision ?? null)
  )
    throw new AgentError("corrupt", "Monitor HEAD manifest mismatch");
  let events: SourceEvent[] = [];
  const operational: SourceEvent[] = [];
  const reportIds = new Set<string>();
  for (const file of manifest.files.filter(
    (f) =>
      f.path === "state/sources/health.json" ||
      (f.path.startsWith("state/runs/") && f.path.endsWith(".json")),
  )) {
    const value = await store.read(prefix + "blobs/" + file.sha256);
    assertBytes(value, file.sha256, file.size);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(value).toString("utf8"));
    } catch {
      throw new AgentError("corrupt", "Monitor projection JSON invalid");
    }
    if (file.path === "state/sources/health.json") {
      const health = parsed as SourceHealth;
      if (health.schema_version !== 1 || !Array.isArray(health.events))
        throw new AgentError("corrupt", "Monitor source-health schema invalid");
      let position = -1;
      for (const event of health.events) {
        if (
          event.execution_scope !== deployment.execution_scope ||
          event.workspace_id !== deployment.workspace_id ||
          !Number.isSafeInteger(event.position) ||
          event.position <= position ||
          typeof event.event_id !== "string" ||
          typeof event.source_id !== "string" ||
          typeof event.reason_code !== "string" ||
          ![
            "occurred",
            "recovered",
            "coverage_gap",
            "gap_resolved",
            "accepted_gap",
          ].includes(event.kind) ||
          !Number.isFinite(Date.parse(event.occurred_at))
        )
          throw new AgentError("corrupt", "Monitor event scope/order invalid");
        position = event.position;
      }
      events = health.events;
    } else {
      const report = parsed as RunReport;
      if (
        report.schema_version !== 1 ||
        report.execution_scope !== deployment.execution_scope ||
        report.workspace_id !== deployment.workspace_id ||
        typeof report.run_id !== "string" ||
        !report.finished_at
      )
        throw new AgentError("corrupt", "Monitor run report schema invalid");
      reportIds.add(report.run_id);
      for (const [index, failure] of (report.failures ?? []).entries()) {
        const reason = /capacity|storage_limit/.test(failure.reason)
          ? "capacity_paused"
          : /unknown|manual|conflict|human|invocation/.test(failure.reason)
            ? "needs_human"
            : null;
        if (reason)
          operational.push({
            event_id: `operational-${report.run_id}-${index}`,
            position: Date.parse(report.finished_at) * 1000 + index,
            workspace_id: deployment.workspace_id,
            execution_scope: deployment.execution_scope,
            source_id: `project:${failure.subject}`,
            reason_code: reason,
            kind: "occurred",
            occurred_at: report.finished_at,
          });
      }
    }
  }
  return { events: [...events, ...operational], reportIds };
}
export interface WatchdogApplicationOptions {
  deployment: Deployment;
  env?: NodeJS.ProcessEnv;
  policy_source?: PolicySource;
  now?: () => Date;
}
export async function runWatchdogApplication(
  options: WatchdogApplicationOptions,
): Promise<unknown> {
  const deployment = parseDeployment(options.deployment);
  if (deployment.execution_scope === "preview")
    throw new Error("Preview has no watchdog Issue capability");
  if (
    deployment.name === "integration" &&
    (!deployment.watchdog_repository ||
      deployment.watchdog_repository === deployment.implementation_repository)
  )
    throw new Error(
      "Integration watchdog requires isolated test Issue repository",
    );
  if (!deployment.enabled_at)
    return { status: "disabled", reason: "monitoring_has_no_activation_time" };
  const env = options.env ?? process.env;
  const token = env[deployment.watchdog_credential_ref ?? ""];
  if (!token) throw new Error("Watchdog Issue credential reference missing");
  const client = token.trim().startsWith("{")
    ? createGitHubAppClient(parseAppCredentials(token))
    : new Octokit({
        auth: token,
        request: { timeout: 30_000 },
        log: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });
  const readToken = env.READING_REPOSITORY_READ_TOKEN;
  const readClient = readToken
    ? new Octokit({
        auth: readToken,
        request: { timeout: 30_000 },
        log: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      })
    : client;
  const [owner, repo] = deployment.implementation_repository.split("/");
  const repository = (
    await readClient.repos.get({ owner: owner!, repo: repo! })
  ).data;
  const source =
    options.policy_source ??
    new GitHubPolicySource(
      readClient,
      owner!,
      repo!,
      repository.default_branch,
    );
  const encoded = env.READING_MONITOR_OSS_CREDENTIALS;
  if (!encoded)
    throw new Error("Readonly monitor OSS credential reference missing");
  let credentials: {
    accessKeyId: string;
    accessKeySecret: string;
    stsToken?: string;
  };
  try {
    credentials = JSON.parse(encoded) as typeof credentials;
  } catch {
    throw new Error("Invalid readonly OSS credential JSON");
  }
  if (!credentials.accessKeyId || !credentials.accessKeySecret)
    throw new Error("Invalid readonly OSS credential structure");
  const store = readonlyObjectStore(
    new OssObjectStore({
      ...credentials,
      bucket: deployment.workspace.bucket,
      region: deployment.workspace.region,
      endpoint: deployment.workspace.endpoint,
      allowed_prefix: deployment.workspace.prefix,
    }),
  );
  const projection = await readMonitorProjection(store, deployment);
  const readPolicy = async () => {
    const policy = parseTrustedPolicy(await source.readSnapshot());
    return {
      global: policy.paused,
      disabled_sources: Object.entries(policy.sources)
        .filter(([, s]) => !s.enabled)
        .map(([id]) => id),
      enabled_at: deployment.enabled_at,
    };
  };
  const projector = new IssueProjector(
    new OctokitIssuePort(
      client,
      deployment.watchdog_repository ?? deployment.implementation_repository,
    ),
    async () => {},
  );
  // No Publisher/ImageStore/SDK/client or formal workspace credential is instantiated.
  return runWatchdog({
    actions: readClient,
    repository: deployment.implementation_repository,
    workspace_id: deployment.workspace_id,
    deployment_name:
      deployment.name === "integration" ? "integration" : "production",
    projector,
    readEvents: async () => projection.events,
    readReportRunIds: async () => projection.reportIds,
    readPolicy,
    ...(options.now ? { now: options.now } : {}),
  });
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve, basename } from "node:path";
import OSS from "ali-oss";
import { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";
import {
  type Deployment,
  executionTarget,
  parseDeployment,
} from "../config/deployment.js";
import type { Dispatch } from "../config/dispatch.js";
import {
  loadOssCredentials,
  type OssCredentials,
} from "../config/credentials.js";
import {
  GitPolicySource,
  GitHubPolicySource,
  parseTrustedPolicy,
  type PolicySource,
} from "../config/trusted-policy.js";
import {
  AgentError,
  sha256,
  canonicalJson,
  type ObjectStore,
  type JsonValue,
  type InvocationRecord,
  type StorageCapacityView,
} from "../contracts/index.js";
import { FileObjectStore } from "../storage/filesystem.js";
import { OssObjectStore } from "../storage/oss.js";
import { listAll, preflight } from "../storage/preflight.js";
import {
  assertCapacity,
  capacityView,
  type StorageReservation,
} from "../storage/capacity.js";
import { assertG1Evidence } from "../storage/gates.js";
import { capacityBrokerFromEnvironment } from "../storage/broker.js";
import { extractPdf } from "../tools/pdf.js";
import type { InventoryObject } from "../storage/inventory.js";
import { ImmutableWorkspaceManager } from "../workspace/manager.js";
import {
  verifyContext,
  buildContext,
  indexNote,
  recallNotes,
  type ContextBundle,
  type NoteIndex,
} from "../context/index.js";
import { materializeSkills, type SkillBundle } from "../tools/skills.js";
import { safeRelative } from "../tools/files.js";
import {
  UrlGateway,
  extractWebSnapshot,
  type GatewayTransport,
  type DnsAddress,
} from "../tools/fetch.js";
import {
  PolicyGate,
  credentialValid,
  type PolicySubject,
} from "../policy/gate.js";
import { RunDeadline } from "../runtime/deadline.js";
import {
  ClaudeSdkAdapter,
  QueryNotStartedError,
  type ModelAdapter,
} from "../runtime/sdk.js";
import { StageExecutor } from "../stages/executor.js";
import {
  registeredCitationUrls,
  type RuntimeEnvironment,
} from "../stages/driver.js";
import { validateWriting, validateReview } from "../stages/validation.js";
import { WebSourceAdapter, type SourceConfig } from "../collect/sources.js";
import { createGitHubAppClient, parseAppCredentials } from "../publish/auth.js";
import { OSSImageStore } from "../publish/oss-images.js";
import { ResourcePublisher, type ImageStore } from "../publish/resources.js";
import { Publisher } from "../publish/publisher.js";
import { OctokitGitHub } from "../publish/github.js";
import {
  deliveryValidationHash,
  validateDelivery,
} from "../publish/validate.js";
import type {
  SealedDelivery,
  DeliveryRecord,
  GitHubPort,
  ResourceReceipt,
  PermissionCheck,
} from "../publish/types.js";
import {
  maintainWorkspace,
  type MaintenanceResult,
  type DeliveryRetentionFact,
} from "./maintenance.js";
import { WorkspaceJournal, ApplicationInvocationJournal } from "./journal.js";
import {
  ReadingController,
  SourceRevisionChanged,
  type HostProject,
  type ControllerPorts,
} from "./controller.js";
const exec = promisify(execFile);
export interface GlobalCapacityInventory {
  complete: boolean;
  objects: InventoryObject[];
  reservations: StorageReservation[];
}
export interface BuildApplicationOptions {
  deployment: Deployment;
  dispatch: Dispatch;
  local?: boolean;
  local_root?: string;
  notes_repository: string;
  implementation_repository?: string;
  policy_source?: PolicySource;
  model_adapter?: ModelAdapter;
  run_id?: string;
  started_at?: number;
  capacity_provider?: () => Promise<GlobalCapacityInventory>;
  env?: NodeJS.ProcessEnv;
  allow_initialize?: boolean;
  gateway_transport?: GatewayTransport;
  gateway_resolver?: (hostname: string) => Promise<DnsAddress[]>;
  github_port?: GitHubPort;
  image_store?: ImageStore;
  heldout?: { urls: Set<string>; note_paths: Set<string> };
  generation_gate?: () => Promise<void>;
  notes_index_provider?: () => Promise<NoteIndex[]>;
  maintenance_mutex?: <T>(work: () => Promise<T>) => Promise<T>;
  retention_delivery_fact?: (id: string) => Promise<DeliveryRetentionFact>;
  image_gc?: () => Promise<{
    deleted: string[];
    retained: string[];
    unknown: string[];
  }>;
}
type StoredDelivery = Omit<SealedDelivery, "files"> & {
  files: (Omit<SealedDelivery["files"][number], "content"> & {
    content_base64: string;
  })[];
};
function encodeDelivery(d: SealedDelivery): StoredDelivery {
  return {
    ...d,
    files: d.files.map(({ content, ...f }) => ({
      ...f,
      content_base64: Buffer.from(content).toString("base64"),
    })),
  };
}
function decodeDelivery(d: StoredDelivery): SealedDelivery {
  return {
    ...d,
    files: d.files.map(({ content_base64, ...f }) => ({
      ...f,
      content: Buffer.from(content_base64, "base64"),
    })),
  };
}
function projectSubject(
  p: HostProject,
  urls = [p.candidate.url],
): PolicySubject {
  return {
    subject_ref: `project:${p.project_id}`,
    project_id: p.project_id,
    candidate_id: p.candidate.candidate_id,
    execution_scope: p.execution_scope,
    origin_source_ids: p.candidate.origin_source_ids,
    urls,
    main_url: p.candidate.url,
    ...(p.classification
      ? { source_snapshot_hash: p.classification.source_snapshot_hash }
      : {}),
    ...(p.classification?.credential
      ? { classification: p.classification.credential }
      : {}),
  };
}
async function credentialsFor(
  ref: string,
  env: NodeJS.ProcessEnv,
): Promise<OssCredentials> {
  if (env[ref]) {
    let value;
    try {
      value = JSON.parse(env[ref]!);
    } catch {
      throw new Error("oss_reference_json_invalid");
    }
    if (
      typeof value?.accessKeyId !== "string" ||
      typeof value?.accessKeySecret !== "string"
    )
      throw new Error("oss_reference_fields_invalid");
    return {
      accessKeyId: value.accessKeyId,
      accessKeySecret: value.accessKeySecret,
      ...(typeof value.stsToken === "string"
        ? { stsToken: value.stsToken }
        : {}),
    };
  }
  throw new Error("oss_scoped_credential_reference_unconfigured");
}
async function fixedGitCommit(
  repository: string,
  ref = "HEAD",
): Promise<string> {
  const result = await exec("git", [
    "-C",
    repository,
    "rev-parse",
    "--verify",
    `${ref}^{commit}`,
  ]);
  const commit = result.stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("trusted_git_commit_invalid");
  return commit;
}
async function gitNotes(
  repository: string,
  commit: string,
  deadline?: RunDeadline,
): Promise<NoteIndex[]> {
  const listing = await exec(
    "git",
    [
      "-C",
      repository,
      "ls-tree",
      "-rz",
      "--full-tree",
      commit,
      "--",
      "Organize Notes By AI/",
    ],
    { maxBuffer: 10_000_000 },
  );
  const notes: NoteIndex[] = [];
  for (const line of listing.stdout.split("\0").filter(Boolean)) {
    deadline?.requireStart();
    const m = /^(100644|100755) blob [a-f0-9]+\t(.+\.md)$/.exec(line);
    if (!m) continue;
    const path = safeRelative(m[2]!);
    const text = (
      await exec("git", ["-C", repository, "show", `${commit}:${path}`], {
        maxBuffer: 10_000_000,
      })
    ).stdout;
    const added = (
      await exec("git", [
        "-C",
        repository,
        "log",
        "--diff-filter=A",
        "--follow",
        "--format=%aI",
        commit,
        "--",
        path,
      ])
    ).stdout
      .trim()
      .split(/\r?\n/)
      .filter((date) => Number.isFinite(Date.parse(date)))
      .at(-1);
    if (!added) throw new Error("first_added_git_unavailable");
    notes.push(indexNote({ path, commit, text, first_added_at: added }));
  }
  return notes;
}
function projectUsage(
  journal: WorkspaceJournal,
  projectId: string,
): SealedDelivery["usage"] {
  const calls = Object.entries(journal.handle.records)
    .filter(([key]) => key.startsWith("invocations/"))
    .map(([, value]) => value as unknown as InvocationRecord)
    .filter((r) => r.subject_id === `project:${projectId}`);
  const known = calls.filter(
    (r) => r.usage.cost_status === "known" && r.usage.cost_usd !== null,
  );
  return {
    status:
      known.length === calls.length && calls.length > 0
        ? "known"
        : known.length
          ? "partial"
          : "unknown",
    estimated_usd: known.length
      ? known.reduce((n, r) => n + (r.usage.cost_usd ?? 0), 0)
      : null,
  };
}
function mappedState(
  project: HostProject,
  record: DeliveryRecord,
): HostProject {
  if (record.status === "awaiting_review")
    return { ...project, state: "pr_open", reason: null, resume_stage: null };
  if (record.status === "merged" || record.status === "closed_unmerged")
    return {
      ...project,
      state: record.status,
      reason: null,
      resume_stage: null,
    };
  if (record.status === "needs_resume")
    return {
      ...project,
      state: "deferred",
      reason: record.reason,
      resume_stage: "review",
      resume_policy: "automatic",
    };
  if (record.status === "delivery_conflict")
    return {
      ...project,
      state: "deferred",
      reason: "delivery_conflict",
      resume_policy: "manual",
    };
  if (record.status === "publishing" && record.uncertain_action === null)
    return {
      ...project,
      state: "ready_for_delivery",
      reason: null,
      resume_stage: null,
      resume_policy: "automatic",
    };
  if (record.status === "policy_blocked")
    return {
      ...project,
      state: "publishing",
      reason: "policy_blocked",
      resume_policy: "when_policy_allows",
    };
  return { ...project, state: "publishing", reason: record.reason };
}

/** Host wiring owns every secret and remote adapter; model tools see only controlled functions. */
export async function buildApplication(
  options: BuildApplicationOptions,
): Promise<{
  controller: ReadingController;
  journal: WorkspaceJournal;
  maintenance: () => Promise<MaintenanceResult>;
}> {
  const deployment = parseDeployment(options.deployment);
  const target = executionTarget(deployment, options.dispatch);
  const providerBinding = {
    model_provider: deployment.model_provider ?? "claude",
    model_base_url: deployment.model_base_url ?? "https://api.anthropic.com",
  } as const;
  const env = options.env ?? process.env;
  const startedAt = env.READING_JOB_STARTED_AT
    ? Number(env.READING_JOB_STARTED_AT)
    : (options.started_at ?? Date.now());
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt <= 0 ||
    startedAt > Date.now() + 1000
  )
    throw new Error("trusted_job_start_invalid");
  if (
    options.local &&
    (deployment.execution_scope !== "preview" ||
      options.dispatch.mode !== "preview")
  )
    throw new Error("local_mode_preview_only");
  if (options.local && !options.model_adapter)
    throw new Error("local_replay_model_required");
  const globalProvider =
    options.capacity_provider ??
    (!options.local
      ? capacityBrokerFromEnvironment(env, deployment)
      : undefined);
  const root = resolve(
    options.local_root ?? env.RUNNER_TEMP ?? ".reading-local",
  );
  await mkdir(root, { recursive: true });
  let store: ObjectStore;
  if (options.local) store = new FileObjectStore(join(root, "object-store"));
  else {
    const credentials = await credentialsFor(
      deployment.workspace.credential_ref,
      env,
    );
    store = new OssObjectStore({
      ...deployment.workspace,
      ...credentials,
      allowed_prefix: deployment.workspace.prefix,
    });
    await preflight(store);
  }
  let journal: WorkspaceJournal | undefined;
  const pending = () =>
    journal
      ? Object.entries(journal.handle.records)
          .filter(([key]) => key.startsWith("storage/reservations/"))
          .map(([, value]) => value as unknown as StorageReservation)
      : [];
  const capacity = async (): Promise<StorageCapacityView> => {
    let global: GlobalCapacityInventory;
    if (globalProvider) global = await globalProvider();
    else
      global = {
        complete: true,
        objects: (await listAll(store, "workspaces/")).map((o) => ({
          ...o,
          bucket: store.bucket,
        })),
        reservations: pending(),
      };
    if (!global.complete) throw new Error("global_capacity_unknown");
    const reservationKey = (r: StorageReservation) =>
      canonicalJson([
        r.bucket,
        r.key,
        r.version,
        r.execution_scope,
        r.reservation_id,
      ]);
    const map = new Map(global.reservations.map((r) => [reservationKey(r), r]));
    for (const r of pending()) map.set(reservationKey(r), r);
    return capacityView(global.objects, [...map.values()]);
  };
  const prefix = options.local
    ? "workspaces"
    : deployment.workspace.prefix.replace(/\/$/, "");
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: target.execution_scope,
    local_root: join(root, "restored"),
    prefix,
    trusted_workspace_id:
      target.execution_scope === "production" ? target.workspace_id : undefined,
    verify_preflight: !options.local,
    lazy_restore: true,
    capacity_check: async (bytes, kind) =>
      assertCapacity(await capacity(), bytes, kind),
  });
  const handle = await manager.restore(target.workspace_id, {
    allow_initialize:
      options.allow_initialize ??
      ["scheduled", "preview"].includes(options.dispatch.mode),
    run_id: options.run_id ?? "initialize",
  });
  journal = new WorkspaceJournal(
    manager,
    handle,
    options.run_id ?? `run_${randomUUID()}`,
  );
  const records = journal;
  const implementation = options.implementation_repository ?? process.cwd();
  const policySource =
    options.policy_source ??
    (options.local
      ? new GitPolicySource(implementation)
      : (() => {
          const readToken =
            env.GITHUB_TOKEN ?? env.READING_REPOSITORY_READ_TOKEN;
          if (!readToken) throw new Error("policy_read_token_unconfigured");
          const [owner, repo] = deployment.implementation_repository.split("/");
          return new GitHubPolicySource(
            new Octokit({
              auth: readToken,
              log: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
              },
            }),
            owner!,
            repo!,
            env.READING_POLICY_BRANCH,
          );
        })());
  const policySnapshot = await policySource.readSnapshot();
  const initialPolicy = parseTrustedPolicy(policySnapshot);
  const gate = new PolicyGate(
    async () => parseTrustedPolicy(await policySource.readSnapshot()),
    (check) => records.commit(`policy-checks/${check.check_id}`, check),
  );
  const runtime = parseYaml(policySnapshot.files["runtime.yaml"]) as Record<
    string,
    unknown
  >;
  const deadline = new RunDeadline(
    startedAt,
    Number(runtime.max_run_minutes ?? 60) * 60_000,
    Number(runtime.shutdown_reserve_minutes ?? 5) * 60_000,
  );
  const gitCommit = await fixedGitCommit(options.notes_repository);
  const index = await gitNotes(options.notes_repository, gitCommit, deadline);
  const currentNoteCache = new Map<string, NoteIndex[]>();
  currentNoteCache.set(gitCommit, index);
  const blobCache = new Map<string, NoteIndex>();
  const currentNotes = async (): Promise<NoteIndex[]> => {
    if (options.notes_index_provider) return options.notes_index_provider();
    if (options.local)
      return gitNotes(
        options.notes_repository,
        await fixedGitCommit(options.notes_repository),
        deadline,
      );
    const readToken = env.READING_REPOSITORY_READ_TOKEN;
    if (!readToken) throw new Error("latest_notes_read_identity_unconfigured");
    const client = new Octokit({
      auth: readToken,
      request: { timeout: 30000 },
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    const repository = deployment.target_repository ?? "unirain/obs-notes-hub";
    const [owner, repo] = repository.split("/");
    const args = { owner: owner!, repo: repo! };
    deadline.requireStart();
    const metadata = (await client.repos.get(args)).data;
    const commit = (
      await client.repos.getCommit({ ...args, ref: metadata.default_branch })
    ).data;
    let result = currentNoteCache.get(commit.sha);
    if (!result) {
      const tree = (
        await client.git.getTree({
          ...args,
          tree_sha: commit.commit.tree.sha,
          recursive: "1",
        })
      ).data;
      if (tree.truncated) throw new Error("current_notes_tree_incomplete");
      result = [];
      for (const entry of tree.tree.filter(
        (e) =>
          e.type === "blob" &&
          e.path?.startsWith("Organize Notes By AI/") &&
          e.path.endsWith(".md"),
      )) {
        deadline.requireStart();
        if (!entry.path || !entry.sha || entry.mode === "120000")
          throw new Error("current_note_unsafe");
        let note = blobCache.get(`${entry.path}:${entry.sha}`);
        if (!note) {
          const blob = (
            await client.git.getBlob({ ...args, file_sha: entry.sha })
          ).data;
          if (
            blob.size === null ||
            blob.size > 10_000_000 ||
            blob.encoding !== "base64"
          )
            throw new Error("current_note_size_or_encoding");
          const text = Buffer.from(
            blob.content.replace(/\n/g, ""),
            "base64",
          ).toString("utf8");
          const history = await client.paginate(client.repos.listCommits, {
            ...args,
            path: entry.path,
            sha: commit.sha,
            per_page: 100,
          });
          const firstAdded = history
            .map((item) => item.commit.author?.date)
            .filter(
              (date): date is string =>
                typeof date === "string" && Number.isFinite(Date.parse(date)),
            )
            .at(-1);
          if (!firstAdded)
            throw new Error("current_note_first_added_unavailable");
          note = indexNote({
            path: entry.path,
            commit: commit.sha,
            text,
            first_added_at: firstAdded,
          });
          blobCache.set(`${entry.path}:${entry.sha}`, note);
        }
        result.push({ ...note, commit: commit.sha });
      }
      currentNoteCache.set(commit.sha, result);
    }
    const combined = [...result];
    const prs = await client.paginate(client.pulls.list, {
      ...args,
      state: "open",
      per_page: 100,
    });
    for (const pr of prs) {
      deadline.requireStart();
      const detail = (
        await client.pulls.get({ ...args, pull_number: pr.number })
      ).data;
      const files = await client.paginate(client.pulls.listFiles, {
        ...args,
        pull_number: pr.number,
        per_page: 100,
      });
      if (files.length !== detail.changed_files)
        throw new Error("pending_notes_diff_incomplete");
      for (const file of files.filter(
        (f) =>
          f.status !== "removed" &&
          f.filename.startsWith("Organize Notes By AI/") &&
          f.filename.endsWith(".md"),
      )) {
        deadline.requireStart();
        if (!file.sha) throw new Error("pending_note_hash_unavailable");
        const blob = (await client.git.getBlob({ ...args, file_sha: file.sha }))
          .data;
        if (
          blob.size === null ||
          blob.size > 10_000_000 ||
          blob.encoding !== "base64"
        )
          throw new Error("pending_note_size_or_encoding");
        combined.push(
          indexNote({
            path: file.filename,
            commit: detail.head.sha,
            text: Buffer.from(
              blob.content.replace(/\n/g, ""),
              "base64",
            ).toString("utf8"),
            first_added_at: detail.created_at,
            pending: true,
          }),
        );
      }
    }
    return combined;
  };
  const currentKnowledge = async (project: HostProject) => {
    const heldout = options.heldout ?? {
      urls: new Set<string>(),
      note_paths: new Set<string>(),
    };
    const query = `${project.candidate.title ?? ""} ${project.candidate.url} ${project.selection?.reason ?? ""}`;
    const selected = recallNotes(await currentNotes(), query, heldout).map(
      (note) => ({
        id: note.id,
        title: note.title,
        summary: note.summary,
        source_urls: note.sources,
        pending: note.pending,
      }),
    );
    const terms = new Set(
      query.toLowerCase().match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g) ?? [],
    );
    const projects: {
      id: string;
      title: string;
      summary: string;
      source_urls: string[];
      pending: boolean;
      score: number;
    }[] = [];
    for (const key of records.keys("projects/")) {
      const current = await records.load<HostProject>(key);
      if (
        !current ||
        current.project_id === project.project_id ||
        ["skipped", "closed_unmerged"].includes(current.state) ||
        heldout.urls.has(current.candidate.url) ||
        (!!current.writing && heldout.note_paths.has(current.writing.note_path))
      )
        continue;
      const summary = [
        current.selection?.reason,
        current.research?.knowledge_increment,
        current.writing?.markdown.replace(/```[\s\S]*?```/g, "").slice(0, 600),
      ]
        .filter(Boolean)
        .join("\n");
      const text = `${current.candidate.title ?? ""} ${summary}`.toLowerCase();
      const score = [...terms].filter((term) => text.includes(term)).length;
      if (summary && score > 0)
        projects.push({
          id: current.project_id,
          title: current.candidate.title ?? current.project_id,
          summary: summary.slice(0, 1000),
          source_urls: [current.candidate.url],
          pending: current.state !== "merged",
          score,
        });
    }
    const view = [
      ...selected,
      ...projects
        .sort((a, b) => b.score - a.score)
        .map(({ score, ...note }) => note),
    ].slice(0, 12);
    const snapshot = {
      project_id: project.project_id,
      query,
      notes: view,
      observed_at: new Date().toISOString(),
    };
    await records.commit(
      `knowledge-views/${sha256(canonicalJson(snapshot))}`,
      snapshot,
    );
    return view;
  };
  const skillCache = new Map<string, SkillBundle>();
  const viewId = randomUUID();
  const trustedSkill = async (
    commit: string,
    projectId: string,
    expectedHash?: string,
  ): Promise<SkillBundle> => {
    const key = `${projectId}:${commit}`;
    let bundle = skillCache.get(key);
    if (!bundle) {
      const view = join(
        root,
        "model-views",
        sha256(target.workspace_id),
        viewId,
        projectId,
        commit,
      );
      await mkdir(view, { recursive: true });
      bundle = await materializeSkills(options.notes_repository, commit, view);
      skillCache.set(key, bundle);
    }
    if (expectedHash && bundle.hash !== expectedHash)
      throw new Error("fixed_skill_hash_unavailable");
    return bundle;
  };
  const contextBundle = await trustedSkill(gitCommit, "context-initial");
  const prompts = ["agent", "selection", "research", "writing", "review"];
  const promptBytes = await Promise.all(
    prompts.map((name) =>
      readFile(
        name === "agent"
          ? join(implementation, "agents/reading/agent.md")
          : join(implementation, "agents/reading/prompts", `${name}.md`),
      ),
    ),
  );
  const promptHash = sha256(Buffer.concat(promptBytes));
  const promptTemplates = Object.fromEntries(
    prompts.map((name, index) => [name, promptBytes[index]!.toString("utf8")]),
  );
  let adapter: ModelAdapter | undefined =
    options.dispatch.mode === "publish-only"
      ? {
          preflight: async () => {
            throw new AgentError("scope", "publish_only_generation_forbidden");
          },
          async *stream() {
            throw new QueryNotStartedError("publish_only_generation_forbidden");
          },
        }
      : options.model_adapter;
  if (!adapter) {
    const key = env[deployment.model_credential_ref];
    if (!key) throw new Error("model_credential_unconfigured");
    const base = new ClaudeSdkAdapter(
      {
        api_key: key,
        provider:
          deployment.model_provider === "deepseek" ? "deepseek" : "anthropic",
        ...(deployment.model_base_url
          ? { base_url: deployment.model_base_url }
          : {}),
      },
      join(root, "sdk-home"),
    );
    adapter = {
      async preflight() {
        const view = await capacity();
        if (!view.accepts_generation)
          throw new AgentError("capacity", "storage_capacity");
        if (options.generation_gate) await options.generation_gate();
        else
          await assertG1Evidence(
            env.READING_G1_EVIDENCE_PATH,
            env.READING_G1_EVIDENCE_SHA256,
          );
      },
      async *stream(request) {
        try {
          const view = await capacity();
          if (!view.accepts_generation) throw new Error("storage_capacity");
          if (options.generation_gate) await options.generation_gate();
          else
            await assertG1Evidence(
              env.READING_G1_EVIDENCE_PATH,
              env.READING_G1_EVIDENCE_SHA256,
            );
        } catch (error) {
          throw new QueryNotStartedError(
            error instanceof Error
              ? error.message
              : "pre_query_environment_unavailable",
          );
        }
        for await (const message of base.stream(request)) yield message;
      },
    };
  }
  const selectedAdapter = adapter;
  const admittedAdapter: ModelAdapter = {
    preflight: async () => {
      const view = await capacity();
      if (!view.accepts_generation)
        throw new AgentError("capacity", "storage_capacity");
      await selectedAdapter.preflight?.();
    },
    stream: (request) => selectedAdapter.stream(request),
  };
  const executor = new StageExecutor(
    admittedAdapter,
    gate,
    new ApplicationInvocationJournal(records),
  );
  function gatewayFor(
    subject: PolicySubject,
    capability: "discover" | "main_read" | "research" = "main_read",
  ): UrlGateway {
    return new UrlGateway(
      async (url) => {
        await gate.require(
          { ...subject, urls: [url] },
          capability,
          "source_gateway",
        );
      },
      options.gateway_resolver,
      options.gateway_transport,
    );
  }
  const sourceYaml = parseYaml(policySnapshot.files["sources.yaml"]) as {
    sources: Record<string, { entry: string; enabled: boolean }>;
    initial_lookback_days?: number;
    page_size?: number;
    overlap_minutes?: number;
  };
  const sources = (["langchain_blog", "claude_resources"] as const).map(
    (source_id) => {
      const config = sourceYaml.sources[source_id];
      if (!config) throw new Error("source_configuration_missing");
      const source: SourceConfig = {
        source_id,
        entry_url: config.entry,
        enabled: config.enabled,
        window_days: sourceYaml.initial_lookback_days ?? 7,
        batch_size: sourceYaml.page_size ?? 50,
        overlap_hours: (sourceYaml.overlap_minutes ?? 10) / 60,
      };
      const gateway = gatewayFor(
        {
          subject_ref: `source:${source_id}`,
          execution_scope: target.execution_scope,
          origin_source_ids: [source_id],
          urls: [config.entry],
        },
        "discover",
      );
      return new WebSourceAdapter(source, async (url) => {
        const read = await gateway.read(url, {
          mime: ["text/html"],
          deadline: deadline.generation_deadline,
        });
        return {
          url: read.url,
          body: Buffer.from(read.bytes).toString("utf8"),
        };
      });
    },
  );
  let publisher: Publisher | undefined;
  let resources: ResourcePublisher | undefined;
  let baseCommit = gitCommit;
  const permission: PermissionCheck = async (capability, projectId) => {
    if (Date.now() >= deadline.deadline) throw new Error("run_hard_deadline");
    if (target.execution_scope === "preview")
      throw new Error("preview_remote_write_denied");
    if (!projectId) throw new Error("project_permission_identity_missing");
    const p = await records.load<HostProject>(`projects/${projectId}`);
    if (!p) throw new Error("permission_project_missing");
    await gate.require(
      projectSubject(p),
      capability === "upload_resource" ? "upload" : "publish",
      "remote_write",
    );
  };
  if (target.execution_scope === "production") {
    if (
      !deployment.image ||
      !deployment.target_repository ||
      !deployment.github_app_credential_ref
    )
      throw new Error("publication_binding_missing");
    let github = options.github_port;
    if (!github) {
      const client = createGitHubAppClient(
        parseAppCredentials(env[deployment.github_app_credential_ref]),
      );
      const [owner, repo] = deployment.target_repository.split("/");
      const repository = (
        await client.repos.get({ owner: owner!, repo: repo! })
      ).data;
      const branch = repository.default_branch;
      baseCommit = (
        await client.git.getRef({
          owner: owner!,
          repo: repo!,
          ref: `heads/${branch}`,
        })
      ).data.object.sha;
      github = new OctokitGitHub(client, deployment.target_repository, branch);
    }
    if (options.dispatch.mode !== "publish-only") {
      let imageStore = options.image_store;
      if (!imageStore) {
        const credentials = await credentialsFor(
          deployment.image.credential_ref,
          env,
        );
        if (
          !deployment.image.sole_writer_verified ||
          deployment.image.versioning === "unknown"
        )
          throw new Error("managed_image_configuration_unverified");
        const actualConfig = await new OssObjectStore({
          ...deployment.image,
          ...credentials,
          allowed_prefix: deployment.image.prefix,
        }).configuration();
        const expected =
          deployment.image.versioning === "disabled"
            ? "never"
            : deployment.image.versioning;
        if (actualConfig.versioning !== expected)
          throw new Error("managed_image_versioning_mismatch");
        const client = new OSS({
          bucket: deployment.image.bucket,
          region: deployment.image.region,
          endpoint: deployment.image.endpoint,
          secure: true,
          ...credentials,
        });
        imageStore = new OSSImageStore(
          client,
          deployment.image.public_url,
          deployment.image.prefix,
        );
      }
      resources = new ResourcePublisher(
        imageStore,
        records,
        {
          reserve: async (key, bytes) => {
            assertCapacity(
              await capacity(),
              bytes +
                65536 +
                records.handle.snapshot.manifest.files.length * 2048,
              "generation",
            );
            const reservation: StorageReservation = {
              reservation_id: sha256(key),
              execution_scope: target.execution_scope,
              bucket: deployment.image!.bucket,
              key,
              version: null,
              expected_bytes: bytes,
              state: "pending",
            };
            await records.commit(
              `storage/reservations/${reservation.reservation_id}`,
              reservation,
            );
          },
          confirm: async (key, receipt) => {
            const old = await records.load<StorageReservation>(
              `storage/reservations/${sha256(key)}`,
            );
            if (!old) throw new Error("image_reservation_missing");
            await records.commit(`storage/reservations/${old.reservation_id}`, {
              ...old,
              version: receipt.version_id,
              state: "confirmed",
            });
          },
        },
        permission,
        deployment.image.prefix,
      );
    }
    publisher = new Publisher(github, records, permission, {
      workspace_id: target.workspace_id,
      committedRevision: async () => records.handle.revision,
      verifyCommittedDelivery: async (d) => {
        const historical = await manager.restoreRevision(
          target.workspace_id,
          d.workspace_revision,
        );
        for (const f of d.files) {
          const path = `projects/${d.project_id}/draft/${f.path}`;
          const committed = historical.snapshot.manifest.files.find(
            (file) => file.path === path,
          );
          if (
            !committed ||
            committed.sha256 !== f.sha256 ||
            committed.size !== f.bytes
          )
            throw new Error("sealed_file_not_committed");
          const content = await manager.readFile(historical, path);
          if (sha256(content) !== f.sha256)
            throw new Error("sealed_file_content_changed");
        }
        validateDelivery(d, {
          id: historical.workspace_id,
          revision: historical.revision,
        });
      },
      classificationCurrent: async (d) => {
        const p = await records.load<HostProject>(`projects/${d.project_id}`);
        if (!p) return false;
        return (
          credentialValid(projectSubject(p), await gate.current()) &&
          p.classification?.credential?.content_eligibility === "allowed"
        );
      },
      identity: {
        name: env.READING_GIT_NAME ?? "Reading Agent",
        email:
          env.READING_GIT_EMAIL ?? "reading-agent@users.noreply.github.com",
      },
    });
  }
  const loadSeal = async (project: HostProject): Promise<SealedDelivery> => {
    if (!project.delivery_id) throw new Error("delivery_identity_missing");
    const stored = await records.load<StoredDelivery>(
      `sealed-${project.delivery_id}`,
    );
    if (!stored) throw new Error("sealed_delivery_missing");
    return decodeDelivery(stored);
  };
  const refreshDelivery = async (
    project: HostProject,
    verifiedAt: string,
  ): Promise<HostProject> => {
    if (!publisher) throw new Error("preview_delivery_refresh_denied");
    const previous = await loadSeal(project);
    const history = await publisher.reconcile(previous);
    const remote = history.find(
      (record) =>
        record.pr ||
        ["awaiting_review", "merged", "closed_unmerged"].includes(
          record.status,
        ),
    );
    if (remote)
      return mappedState(
        { ...project, delivery_id: remote.delivery_id },
        remote,
      );
    const old = history.find(
      (record) => record.delivery_id === previous.delivery_id,
    );
    if (old?.superseded_by) {
      const successor = await records.load<StoredDelivery>(
        `sealed-${old.superseded_by}`,
      );
      if (!successor) throw new Error("refreshed_delivery_missing");
      return {
        ...project,
        delivery_id: old.superseded_by,
        sources_verified_at: successor.sources_verified_at,
        state: "ready_for_delivery",
        reason: null,
        resume_stage: null,
      };
    }
    const next = await publisher.refreshVerified(previous, {
      delivery_id: `${previous.delivery_id}_verify_${sha256(verifiedAt).slice(0, 12)}`,
      workspace_revision: records.handle.revision,
      sources_verified_at: verifiedAt,
    });
    const updated: HostProject = {
      ...project,
      delivery_id: next.delivery_id,
      sources_verified_at: verifiedAt,
      state: "ready_for_delivery",
      reason: null,
      resume_stage: null,
    };
    await records.commit(`projects/${project.project_id}`, updated);
    return updated;
  };
  const ports: ControllerPorts = {
    ...{
      refreshDelivery,
      readArtifact: (path: string) => manager.readFile(records.handle, path),
    },
    journal: records,
    gate,
    deadline,
    sources,
    context: async (candidate) => {
      const bundle = buildContext({
        index,
        query: `${candidate.title ?? ""} ${candidate.url}`,
        heldout: options.heldout ?? { urls: new Set(), note_paths: new Set() },
        preferences_hash: initialPolicy.hash,
        tool_domains: [...initialPolicy.allowed_domains],
        skill_commit: gitCommit,
        skill_hash: contextBundle.hash,
        prompt_hash: promptHash,
        prompt_templates: promptTemplates,
        runtime_limits: {
          max_output_tokens: Number(runtime.max_output_tokens ?? 8192),
          max_download_bytes: Number(
            runtime.max_download_bytes_per_batch ??
              runtime.max_download_bytes ??
              64_000_000,
          ),
          max_resources: Number(
            runtime.max_resources_per_batch ?? runtime.max_resources ?? 40,
          ),
        },
        model: deployment.model,
        ...providerBinding,
        evidence_versions: candidate.content_hash
          ? [candidate.content_hash]
          : [],
      });
      verifyContext(bundle);
      await records.commitMany(
        { [`contexts/${bundle.context_id}`]: bundle },
        "generation_context_fixed",
        [
          {
            path: `inputs/${bundle.context_id}/context.json`,
            role: "input",
            bytes: Buffer.from(JSON.stringify(bundle)),
          },
        ],
      );
      return bundle;
    },
    environment: async (project, commit) => {
      verifyContext(
        project.context,
        options.dispatch.mode === "publish-only" ? undefined : providerBinding,
      );
      const fixed = await records.load<ContextBundle>(
        `contexts/${project.context.context_id}`,
      );
      if (!fixed || canonicalJson(fixed) !== canonicalJson(project.context))
        throw new Error("fixed_context_unavailable");
      const skills = await trustedSkill(
        project.context.skill_commit,
        project.project_id,
        project.context.skill_hash,
      );
      for (const file of records.handle.snapshot.manifest.files.filter((f) =>
        f.path.startsWith(`projects/${project.project_id}/`),
      )) {
        const relative = safeRelative(file.path);
        const dest = join(skills.root, relative);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, await manager.readFile(records.handle, relative));
      }
      return {
        root: skills.root,
        model: project.context.model,
        executor,
        gate,
        gateway: gatewayFor(projectSubject(project)),
        deadline,
        skills,
        commit,
        read_current_knowledge: () => currentKnowledge(project),
      } satisfies RuntimeEnvironment;
    },
    prepareResources: async (original, files) => {
      if (!resources || !original.writing || !original.research)
        throw new Error("resource_publication_unavailable");
      const project = structuredClone(original);
      const writing = project.writing!;
      if (!project.note_date)
        throw new Error("fixed_first_generation_date_missing");
      const receipts: ResourceReceipt[] = [];
      for (const [resourceIndex, resource] of writing.resources.entries()) {
        const bytes = files[resource.path];
        if (!bytes || sha256(bytes) !== resource.hash)
          throw new Error("resource_input_changed");
        const ext = resource.path.split(".").at(-1);
        if (!["png", "jpg", "svg", "webp"].includes(ext ?? ""))
          throw new Error("resource_extension_denied");
        const receipt = await resources.upload({
          project_id: project.project_id,
          first_generated_date: project.note_date!,
          article_slug: project.project_id,
          description:
            basename(resource.source_path ?? resource.path)
              .replace(/\.[^.]+$/, "")
              .replace(/[^a-zA-Z0-9_-]+/g, "-")
              .replace(/^-+|-+$/g, "") || `diagram-${resourceIndex + 1}`,
          extension: ext as "png" | "jpg" | "svg" | "webp",
          mime: resource.mime,
          content: bytes,
        });
        receipts.push(receipt);
        const local = `../${resource.path}`;
        writing.markdown = writing.markdown
          .split(`](${local})`)
          .join(`](${receipt.url})`)
          .split(`](${resource.path})`)
          .join(`](${receipt.url})`);
        for (const ref of [local, resource.path])
          writing.markdown = writing.markdown
            .split(`src="${ref}"`)
            .join(`src="${receipt.url}"`)
            .split(`src='${ref}'`)
            .join(`src='${receipt.url}'`);
        resource.url = receipt.url;
      }
      validateWriting(
        writing,
        project.research!.evidence,
        "production",
        files,
        true,
        [
          project.candidate.url,
          ...project.snapshots
            .filter(
              (snapshot) =>
                snapshot.requested_url === project.candidate.url ||
                snapshot.url === project.candidate.url,
            )
            .map((snapshot) => snapshot.url),
        ],
        registeredCitationUrls(project),
      );
      await records.commitMany(
        {
          [`projects/${project.project_id}`]: project,
          [`resources/${project.project_id}`]: receipts,
        },
        "resource_urls_applied",
        [
          {
            path: `projects/${project.project_id}/draft/${writing.note_path}`,
            role: "artifact",
            project_id: project.project_id,
            bytes: Buffer.from(writing.markdown),
          },
        ],
      );
      return project;
    },
    verifySources: async (project) => {
      if (!project.research) throw new Error("research_missing");
      const gateway = gatewayFor(projectSubject(project), "research");
      for (const version of project.research.source_versions.filter(
        (s) => s.core || s.main,
      )) {
        const snapshot = project.snapshots.find((s) => s.url === version.url);
        if (!snapshot) throw new Error("core_snapshot_unavailable");
        const response = await gateway.read(
          snapshot.requested_url ?? snapshot.url,
          { deadline: deadline.generation_deadline },
        );
        const current =
          response.mime === "text/html"
            ? extractWebSnapshot(
                response.url,
                Buffer.from(response.bytes).toString("utf8"),
                new Date().toISOString(),
              ).hash
            : response.mime === "application/pdf"
              ? (
                  await extractPdf(
                    response.bytes,
                    response.url,
                    join(root, "source-reverification"),
                    deadline.generation_deadline,
                  )
                ).hash
              : sha256(Buffer.from(response.bytes).toString("utf8"));
        if (current !== snapshot.hash)
          throw new SourceRevisionChanged(snapshot.url, current);
      }
      return new Date().toISOString();
    },
    seal: async (project, files) => {
      if (
        !publisher ||
        !project.writing ||
        !project.review ||
        !project.research ||
        !project.delivery_id ||
        !project.sources_verified_at
      )
        throw new Error("delivery_seal_preconditions");
      validateWriting(
        project.writing,
        project.research.evidence,
        "production",
        files,
        true,
        [
          project.candidate.url,
          ...project.snapshots
            .filter(
              (snapshot) =>
                snapshot.requested_url === project.candidate.url ||
                snapshot.url === project.candidate.url,
            )
            .map((snapshot) => snapshot.url),
        ],
        registeredCitationUrls(project),
      );
      validateReview(
        project.review,
        project.writing,
        files,
        sha256(canonicalJson(project.writing.resources)),
      );
      if (project.review.issues.some((issue) => issue.severity === "blocking"))
        throw new Error("delivery_review_blocked");
      const receipts =
        (await records.load<ResourceReceipt[]>(
          `resources/${project.project_id}`,
        )) ?? [];
      const d: SealedDelivery = {
        schema_version: 1,
        delivery_id: project.delivery_id,
        execution_scope: "production",
        workspace_id: target.workspace_id,
        project_id: project.project_id,
        generation_version: project.generation_version,
        workspace_revision: records.handle.revision,
        context_id: project.context.context_id,
        base_commit: baseCommit,
        sources_verified_at: project.sources_verified_at,
        files: [
          {
            path: project.writing.note_path,
            role: "note",
            mime: "text/markdown",
            content: Buffer.from(project.writing.markdown),
            bytes: Buffer.byteLength(project.writing.markdown),
            sha256: sha256(project.writing.markdown),
          },
          ...project.writing.resources
            .filter((r) => r.source_path)
            .map((r) => {
              const path = r.source_path!;
              const content = files[path];
              if (!content) throw new Error("diagram_source_missing");
              const ext = path.split(".").at(-1);
              const mime =
                ext === "svg"
                  ? "image/svg+xml"
                  : ext === "json"
                    ? "application/json"
                    : ext === "drawio"
                      ? "application/xml"
                      : "text/plain";
              return {
                path,
                role: "diagram_source" as const,
                mime,
                content,
                bytes: content.length,
                sha256: sha256(content),
              };
            }),
        ],
        resources: receipts,
        sources: [
          ...new Set([
            project.snapshots.find(
              (s) =>
                s.requested_url === project.candidate.url ||
                s.url === project.candidate.url,
            )?.url ?? project.candidate.url,
            ...project.snapshots.map((s) => s.url),
          ]),
        ],
        quality_report: { review: project.review, checks: "passed" },
        rationale: project.selection?.reason ?? "",
        knowledge_increment: project.research.knowledge_increment,
        gaps: project.research.gaps.map((g) => `${g.url}: ${g.reason}`),
        image_degradations: project.writing.degradations,
        usage: projectUsage(records, project.project_id),
        warnings: [],
        validated_hash: "",
      };
      d.validated_hash = deliveryValidationHash(d);
      validateDelivery(d, {
        id: target.workspace_id,
        revision: records.handle.revision,
      });
      await records.commit(`sealed-${d.delivery_id}`, encodeDelivery(d));
    },
    reconcile: async (project) => {
      if (!publisher) return project;
      const seal = await loadSeal(project);
      const facts = await publisher.reconcile(seal);
      const latest = facts.find((r) => r.delivery_id === project.delivery_id);
      if (!latest)
        return {
          ...project,
          state: "ready_for_delivery",
          reason: null,
          resume_stage: null,
        };
      if (latest.status === "policy_blocked") {
        const check = await gate.check(
          projectSubject(project),
          "publish",
          "policy_recovery",
        );
        if (check.execution_permission === "allowed")
          return {
            ...project,
            state: "ready_for_delivery",
            reason: null,
            resume_stage: null,
            resume_policy: "automatic",
          };
      }
      return mappedState(project, latest);
    },
    publish: async (project) => {
      if (!publisher) throw new Error("preview_publication_denied");
      return mappedState(
        project,
        await publisher.publish(
          await loadSeal(project),
          options.dispatch.mode === "resume"
            ? "resume"
            : options.dispatch.mode === "publish-only"
              ? "publish-only"
              : "scheduled",
        ),
      );
    },
  };
  return {
    controller: new ReadingController(ports),
    journal: records,
    maintenance: () =>
      maintainWorkspace({
        manager,
        journal: records,
        store,
        prefix: manager.prefix(target.workspace_id),
        with_mutex:
          options.maintenance_mutex ??
          (async (work) => {
            if (env.READING_SHARED_MUTEX_HELD !== "true")
              throw new Error("storage_writer_mutex_unverified");
            return work();
          }),
        ...(options.retention_delivery_fact
          ? { delivery_fact: options.retention_delivery_fact }
          : {}),
        ...(options.image_gc ? { image_gc: options.image_gc } : {}),
      }),
  };
}

export interface BuildMaintenanceOptions {
  deployment: Deployment;
  dispatch: Dispatch;
  local?: boolean;
  local_root?: string;
  run_id?: string;
  env?: NodeJS.ProcessEnv;
  capacity_provider?: () => Promise<GlobalCapacityInventory>;
  maintenance_mutex?: <T>(work: () => Promise<T>) => Promise<T>;
  retention_delivery_fact?: (id: string) => Promise<DeliveryRetentionFact>;
  image_gc?: () => Promise<{
    deleted: string[];
    retained: string[];
    unknown: string[];
  }>;
}
/** Storage-only maintenance entry: no SDK, image upload adapter, notes/skill materialization or PR writes. */
export async function buildMaintenanceApplication(
  options: BuildMaintenanceOptions,
): Promise<{
  journal: WorkspaceJournal;
  maintenance: () => Promise<MaintenanceResult>;
}> {
  const deployment = parseDeployment(options.deployment);
  const target = executionTarget(deployment, options.dispatch);
  const env = options.env ?? process.env;
  if (options.local && target.execution_scope !== "preview")
    throw new Error("local_maintenance_preview_only");
  const root = resolve(
    options.local_root ?? env.RUNNER_TEMP ?? ".reading-local",
  );
  await mkdir(root, { recursive: true });
  const store: ObjectStore = options.local
    ? new FileObjectStore(join(root, "object-store"))
    : new OssObjectStore({
        ...deployment.workspace,
        ...(await credentialsFor(deployment.workspace.credential_ref, env)),
        allowed_prefix: deployment.workspace.prefix,
      });
  if (!options.local) await preflight(store);
  const provider =
    options.capacity_provider ??
    (!options.local
      ? capacityBrokerFromEnvironment(env, deployment)
      : undefined);
  let journal: WorkspaceJournal | undefined;
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: target.execution_scope,
    local_root: join(root, "restored"),
    prefix: options.local
      ? "workspaces"
      : deployment.workspace.prefix.replace(/\/$/, ""),
    trusted_workspace_id:
      target.execution_scope === "production" ? target.workspace_id : undefined,
    verify_preflight: !options.local,
    lazy_restore: true,
    capacity_check: async (bytes, kind) => {
      const global = provider
        ? await provider()
        : {
            complete: true,
            objects: (await listAll(store, "workspaces/")).map((o) => ({
              ...o,
              bucket: store.bucket,
            })),
            reservations: [],
          };
      if (!global.complete) throw new Error("global_capacity_unknown");
      const pending = journal
        ? Object.entries(journal.handle.records)
            .filter(([key]) => key.startsWith("storage/reservations/"))
            .map(([, value]) => value as unknown as StorageReservation)
        : [];
      const key = (r: StorageReservation) =>
        canonicalJson([
          r.bucket,
          r.key,
          r.version,
          r.execution_scope,
          r.reservation_id,
        ]);
      const map = new Map(global.reservations.map((r) => [key(r), r]));
      for (const r of pending) map.set(key(r), r);
      assertCapacity(
        capacityView(global.objects, [...map.values()]),
        bytes,
        kind,
      );
    },
  });
  const handle = await manager.restore(target.workspace_id);
  journal = new WorkspaceJournal(
    manager,
    handle,
    options.run_id ?? `maintenance_${randomUUID()}`,
  );
  const records = journal;
  let client: Octokit | undefined;
  const fact =
    options.retention_delivery_fact ??
    (async (id: string): Promise<DeliveryRetentionFact> => {
      if (
        target.execution_scope === "preview" ||
        !deployment.github_app_credential_ref ||
        !deployment.target_repository
      )
        return { status: "unknown", complete: false };
      const record = await records.load<DeliveryRecord>(`delivery-${id}`);
      if (!record?.pr) return { status: "unknown", complete: false };
      try {
        client ??= createGitHubAppClient(
          parseAppCredentials(env[deployment.github_app_credential_ref]),
        );
        const [owner, repo] = deployment.target_repository.split("/");
        const pr = (
          await client.pulls.get({
            owner: owner!,
            repo: repo!,
            pull_number: record.pr.number,
          })
        ).data;
        if (pr.merged)
          return {
            status: "merged",
            finished_at: pr.merged_at ?? undefined,
            complete: true,
          };
        if (pr.state === "closed")
          return {
            status: "closed_unmerged",
            finished_at: pr.closed_at ?? undefined,
            complete: true,
          };
        return { status: "open", complete: true };
      } catch {
        return { status: "unknown", complete: false };
      }
    });
  return {
    journal: records,
    maintenance: () =>
      maintainWorkspace({
        manager,
        journal: records,
        store,
        prefix: manager.prefix(target.workspace_id),
        with_mutex:
          options.maintenance_mutex ??
          (async (work) => {
            if (env.READING_SHARED_MUTEX_HELD !== "true")
              throw new Error("storage_writer_mutex_unverified");
            return work();
          }),
        delivery_fact: fact,
        ...(options.image_gc ? { image_gc: options.image_gc } : {}),
      }),
  };
}

import { readInstalledSdkVersion } from "../../src/runtime/versions.js";
import {READING_CLOUD_CONTRACT} from '../../src/tools/skills.js';
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { verifyContext, type ContextBundle } from "../../src/context/index.js";
import type { ObjectStore } from "../../src/contracts/index.js";
import type { GitHubPort } from "../../src/publish/types.js";
const sandbox = vi.hoisted(() => ({
  store: null as ObjectStore | null,
  providers: [] as { provider?: string; base_url?: string }[],
}));
vi.mock("../../src/storage/oss.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/storage/oss.js")>();
  return {
    ...actual,
    OssObjectStore: class {
      constructor() {
        if (!sandbox.store) throw new Error("isolated_test_store_unconfigured");
        return sandbox.store;
      }
    },
  };
});
vi.mock("../../src/runtime/sdk.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/runtime/sdk.js")>();
  return {
    ...actual,
    ClaudeSdkAdapter: class extends actual.ClaudeSdkAdapter {
      constructor(
        secrets: import("../../src/runtime/sdk.js").SdkSecrets,
        home: string,
      ) {
        sandbox.providers.push({
          provider: secrets.provider,
          base_url: secrets.base_url,
        });
        super(secrets, home);
      }
    },
  };
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import { buildApplication, projectSubject } from "../../src/app/bootstrap.js";
import type { HostProject } from "../../src/app/controller.js";
import { PolicyGate, type TrustedPolicy } from "../../src/policy/gate.js";
import type { ModelAdapter } from "../../src/runtime/sdk.js";
import type { PolicySource } from "../../src/config/trusted-policy.js";
import { parseDeployment } from "../../src/config/deployment.js";
import {
  assertG1Evidence,
  G1_REQUIRED_ASSERTIONS,
} from "../../src/storage/gates.js";
import { sha256, canonicalJson } from "../../src/contracts/index.js";
const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bootstrap-eval-"));
  const notes = join(root, "notes");
  await mkdir(join(notes, ".agents/skills/obsidian-note"), { recursive: true });
  await mkdir(join(notes, ".agents/skills/fireworks-tech-graph"), {
    recursive: true,
  });
  await writeFile(
    join(notes, ".agents/skills/obsidian-note/SKILL.md"),
    "<!-- reading-agent-cloud-contract: obs-reading-agent-cloud/v1 -->\nUse VAULT_ROOT to read fixed note guidelines.",
  );
  await writeFile(
    join(notes, ".agents/skills/fireworks-tech-graph/SKILL.md"),
    "<!-- reading-agent-cloud-contract: obs-reading-agent-cloud/v1 -->\nFixed diagrams.",
  );
  await mkdir(join(notes,'.agents/skills/obsidian-note/references'),{recursive:true});
  await writeFile(join(notes,'.agents/skills/obsidian-note/references/diagram-playbook.md'),'<!-- reading-agent-cloud-contract: obs-reading-agent-cloud/v1 -->\nFixed diagram rules.');
  await writeFile(join(notes,'.agents/skills/obsidian-note/references/reading-agent-cloud-contract.json'),JSON.stringify(READING_CLOUD_CONTRACT));
  await mkdir(join(notes, "Organize Notes By AI"), { recursive: true });
  await writeFile(
    join(notes, "Organize Notes By AI/261013-Reference.md"),
    "---\ntitle: Reference\ncreated: 2026-10-13\ntags: [agent, engineering, practice]\nsource: https://example.org/reference\n---\n# Engineering mechanism\nAgent engineering mechanism evidence.",
  );
  await exec("git", ["init", notes]);
  await exec("git", ["-C", notes, "add", "."]);
  await exec("git", [
    "-C",
    notes,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "-m",
    "fixed-test-fixture",
  ]);
  const deployment = parseDeployment(
    JSON.parse(
      await readFile("agents/reading/deploy/examples/preview.json", "utf8"),
    ),
  );
  const implementation = process.cwd();
  const files = {
    "preferences.yaml": await readFile(
      join(implementation, "agents/reading/preferences.yaml"),
      "utf8",
    ),
    "sources.yaml": await readFile(
      join(implementation, "agents/reading/sources.yaml"),
      "utf8",
    ),
    "runtime.yaml": await readFile(
      join(implementation, "agents/reading/runtime.yaml"),
      "utf8",
    ),
  };
  const policy: PolicySource = {
    readSnapshot: async () => ({ commit: "a".repeat(40), files }),
  };
  return { root, notes, deployment, implementation, policy };
}
it("wired local preview uses real durable manager, controlled source/classifier and no remote publication on next run", async () => {
  const f = await fixture();
  let calls = 0;
  let observedKnowledge: unknown;
  const model: ModelAdapter = {
    async *stream(request) {
      calls++;
      const knowledgeTool = request.tools.find(
        (tool) => tool.name === "read_related_summary",
      );
      observedKnowledge = await knowledgeTool?.run({});
      const mainView = (await request.tools
        .find((tool) => tool.name === "read_main")!
        .run({})) as { lines: { text: string }[] };
      const main = mainView.lines[0]!.text;
      yield {
        message_id: `result-${calls}`,
        type: "result",
        summary: true,
        success: true,
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          cost_usd: null,
          cost_status: "unknown",
        },
        result: {
          content_eligibility: "excluded",
          content_type: "product_announcement",
          topic: "new model launch",
          reason_codes: ["product_announcement"],
          evidence: [{ start_line: 1, end_line: 1, excerpt: main }],
        },
        observable: {},
      };
    },
  };
  const dispatch = {
    mode: "preview" as const,
    preview_id: "factory",
    input_urls: ["https://example.org/agent/engineering"],
    project_id: null,
    submission_id: null,
  };
  const options = {
    deployment: f.deployment,
    dispatch,
    local: true,
    local_root: join(f.root, "workspace"),
    notes_repository: f.notes,
    policy_source: f.policy,
    model_adapter: model,
    // Controlled replay fixture: no Docker tool is exercised by this classifier.
    runtime_versions_provider: async () => ({
      ...(await readInstalledSdkVersion()),
      tools_image_id: "sha256:" + "0".repeat(64),
      tools_manifest_hash: "0".repeat(64),
    }),
    gateway_resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    gateway_transport: async () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from(
        "<html><body><main><p>We are launching a new product today with new pricing.</p></main></body></html>",
      ),
    }),
  };
  const first = await buildApplication(options);
  const report = await first.controller.run(dispatch, "fixture");
  expect(report.execution_scope).toBe("preview");
  expect(report.failures).toEqual([]);
  expect(report.outcome).toBe("success_no_selection");
  expect(calls).toBe(1);
  expect(observedKnowledge).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Reference",
        source_urls: ["https://example.org/reference"],
      }),
    ]),
  );
  const projects = first.journal.keys("projects/");
  expect(projects.length).toBe(1);
  expect(await first.journal.load(projects[0]!)).toMatchObject({
    state: "skipped",
  });
  const context = (await first.journal.load<{ context: ContextBundle }>(
    projects[0]!,
  ))!.context;
  expect(context.prompt_templates?.agent).toBe(
    await readFile("agents/reading/agent.md", "utf8"),
  );
  const altered = {
    ...context,
    prompt_templates: {
      ...context.prompt_templates!,
      agent: "untrusted modified instructions",
    },
  };
  const { context_id: oldContextId, ...rest } = altered;
  altered.context_id = sha256(canonicalJson(rest));
  expect(() => verifyContext(altered)).toThrow("fixed_prompt_hash_mismatch");
  const host = (await first.journal.load<HostProject>(projects[0]!))!;
  const scopedPolicy: TrustedPolicy = {
    commit: "a".repeat(40),
    hash: "5f161c9149882e0e10124bc5dd5c11f0fbe8ec452edd52bcec76b01e9252cb33",
    semantic_policy_hash: "3784070fe3e7e3de5f0ec08eadfa10acbaa0f543916b1ab2c68f371924ff7db3",
    paused: false,
    paused_projects: [],
    sources: {},
    manual_url: { enabled: true },
    allowed_domains: [
      ...context.tool_domains!,
      "scope-expansion.example",
      "revoked.example",
    ],
    denied_domains: ["revoked.example"],
    excluded_topics: [],
  };
  const hostGate = new PolicyGate(
    async () => scopedPolicy,
    async () => {},
  );
  await expect(
    hostGate.require(
      projectSubject(host, ["https://scope-expansion.example/reference"]),
      "main_read",
      "host_gateway",
    ),
  ).rejects.toThrow("domain_outside_original_scope");
  host.candidate.aliases.push("https://revoked.example/alias");
  await expect(
    hostGate.require(projectSubject(host), "main_read", "host_permission"),
  ).rejects.toThrow("domain_denied:revoked.example");
  host.candidate.aliases = host.candidate.aliases.filter(
    (url) => !url.includes("revoked.example"),
  );
  host.snapshots[0]!.url = "https://revoked.example/core";
  await expect(
    hostGate.require(
      projectSubject(host),
      "main_read",
      "host_source_verification",
    ),
  ).rejects.toThrow("domain_denied:revoked.example");
  const next = await buildApplication({ ...options, run_id: "next-run" });
  await next.controller.run({ ...dispatch, input_urls: [] }, "fixture");
  expect(calls).toBe(1);
  expect(next.journal.keys("delivery-")).toHaveLength(0);
});
it("local mode cannot acquire production capabilities and live preview requires explicit global capacity broker", async () => {
  const f = await fixture();
  const production = JSON.parse(
    await readFile("agents/reading/deploy/examples/production.json", "utf8"),
  );
  await expect(
    buildApplication({
      deployment: production,
      dispatch: {
        mode: "scheduled",
        input_urls: [],
        project_id: null,
        submission_id: null,
        preview_id: null,
      },
      local: true,
      notes_repository: f.notes,
    }),
  ).rejects.toThrow("local_mode_preview_only");
  await expect(
    buildApplication({
      deployment: f.deployment,
      dispatch: {
        mode: "preview",
        input_urls: [],
        project_id: null,
        submission_id: null,
        preview_id: "required",
      },
      notes_repository: f.notes,
      env: {READING_SHARED_MUTEX_HELD:'true'},
    }),
  ).rejects.toThrow("capacity_broker_credentials_unconfigured");
});
it('live host refuses a writer before reading credentials or initializing a workspace without the shared mutex',async()=>{
 const f=await fixture();const env=new Proxy({} as NodeJS.ProcessEnv,{get(_target,key){if(key==='READING_SHARED_MUTEX_HELD')return undefined;throw new Error('must_not_read_credentials');}});
 await expect(buildApplication({deployment:f.deployment,dispatch:{mode:'preview',input_urls:[],project_id:null,submission_id:null,preview_id:'mutex'},notes_repository:f.notes,env})).rejects.toThrow('storage_writer_mutex_unverified');
});
it("persistent G1 evidence requires every actual live assertion and trusted hash; partial probe cannot authorize generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "gate-eval-"));
  const path = join(root, "g1.json");
  const report = {
    schema_version: 1,
    gate: "G1",
    status: "complete",
    isolated_resources: true,
    sdk: "ali-oss@6.23.0",
    observed_at: "2026-10-13T08:33:41.512Z",
    assertions: Object.fromEntries(
      G1_REQUIRED_ASSERTIONS.map((name) => [name, "passed"]),
    ),
  };
  const bytes = JSON.stringify(report);
  await writeFile(path, bytes);
  await expect(assertG1Evidence(path, sha256(bytes))).resolves.toBeUndefined();
  await expect(assertG1Evidence(path, "a".repeat(64))).rejects.toMatchObject({
    code: "corrupt",
  });
  report.assertions.preview_ram_write_deny = "live_unverified";
  const partial = JSON.stringify(report);
  await writeFile(path, partial);
  await expect(assertG1Evidence(path, sha256(partial))).rejects.toMatchObject({
    code: "configuration",
  });
});
it("publish-only restores an isolated production-scope chain without loading model or image upload credentials or constructing SDK", async () => {
  const f = await fixture();
  const deployment = parseDeployment(
    JSON.parse(
      await readFile("agents/reading/deploy/examples/integration.json", "utf8"),
    ),
  );
  const store = new FileObjectStore(join(f.root, "pub-only-objects"), 1000, {
    versioning: "never",
    acl: "private",
    endpoint: "https://oss-cn-beijing.aliyuncs.com",
    lifecycle: [],
    anonymous_readable: false,
  });
  sandbox.store = store;
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "production",
    local_root: join(f.root, "pub-first"),
    prefix: deployment.workspace.prefix.replace(/\/$/, ""),
    trusted_workspace_id: deployment.workspace_id,
    verify_preflight: false,
  });
  const initial = await manager.restore(deployment.workspace_id, {
    allow_initialize: true,
  });
  const noRemote: GitHubPort = {
    prepare: async () => {
      throw new Error("unexpected_remote");
    },
    inspect: async () => {
      throw new Error("unexpected_remote");
    },
    materialize: async () => {
      throw new Error("unexpected_remote");
    },
    createBranch: async () => {
      throw new Error("unexpected_remote");
    },
    createPR: async () => {
      throw new Error("unexpected_remote");
    },
  };
  const before = sandbox.providers.length;
  const env = new Proxy(
    {
      READING_SHARED_MUTEX_HELD:'true',
      [deployment.workspace.credential_ref]: JSON.stringify({
        accessKeyId: "isolated-id",
        accessKeySecret: "isolated-secret",
      }),
    } as NodeJS.ProcessEnv,
    {
      get(target, key) {
        if (
          key === deployment.model_credential_ref ||
          key === deployment.image!.credential_ref
        )
          throw new Error("forbidden_generation_credential_read");
        return Reflect.get(target, key);
      },
    },
  );
  const app = await buildApplication({
    deployment,
    dispatch: {
      mode: "publish-only",
      input_urls: [],
      project_id: "missing",
      preview_id: null,
      submission_id: null,
    },
    notes_repository: f.notes,
    local_root: join(f.root, "pub-next"),
    policy_source: f.policy,
    github_port: noRemote,
    capacity_provider: async () => ({
      complete: true,
      objects: [],
      reservations: [],
    }),
    env,
  });
  expect(app.journal.handle.revision).toBe(initial.revision);
  expect(sandbox.providers).toHaveLength(before);
  expect(app.journal.keys("invocations/")).toHaveLength(0);
});
it("real SDK adapter composition binds trusted DeepSeek provider and endpoint and fixed agent text without starting a query", async () => {
  const f = await fixture();
  const store = new FileObjectStore(join(f.root, "provider-objects"), 1000, {
    versioning: "never",
    acl: "private",
    endpoint: "https://oss-cn-beijing.aliyuncs.com",
    lifecycle: [],
    anonymous_readable: false,
  });
  sandbox.store = store;
  const before = sandbox.providers.length;
  const app = await buildApplication({
    deployment: f.deployment,
    dispatch: {
      mode: "preview",
      input_urls: [],
      project_id: null,
      preview_id: "provider",
      submission_id: null,
    },
    notes_repository: f.notes,
    local_root: join(f.root, "provider-local"),
    policy_source: f.policy,
    capacity_provider: async () => ({
      complete: true,
      objects: [],
      reservations: [],
    }),
    env: {
      READING_SHARED_MUTEX_HELD:'true',
      [f.deployment.workspace.credential_ref]: JSON.stringify({
        accessKeyId: "isolated-id",
        accessKeySecret: "isolated-secret",
      }),
      [f.deployment.model_credential_ref]: "test-only-model-key",
    },
  });
  expect(sandbox.providers[before]).toEqual({
    provider: "deepseek",
    base_url: "https://api.deepseek.com/anthropic",
  });
  expect(app.journal.keys("invocations/")).toHaveLength(0);
});
it("job clock includes startup time; an already expired original job cannot begin generation", async () => {
  const f = await fixture();
  await expect(
    buildApplication({
      deployment: f.deployment,
      dispatch: {
        mode: "preview",
        input_urls: [],
        project_id: null,
        preview_id: "expired",
        submission_id: null,
      },
      local: true,
      local_root: join(f.root, "expired"),
      notes_repository: f.notes,
      policy_source: f.policy,
      model_adapter: {
        async *stream() {
          throw new Error("unexpected_query");
        },
      },
      started_at: Date.now() - 61 * 60_000,
    }),
  ).rejects.toThrow("run_deadline");
});

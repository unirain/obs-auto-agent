import { describe, it, expect,vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { WorkspaceJournal } from "../../src/app/journal.js";
import {
  ReadingController,
  type ControllerPorts,
  type HostProject,
} from "../../src/app/controller.js";
import { PolicyGate, type TrustedPolicy } from "../../src/policy/gate.js";
import { RunDeadline } from "../../src/runtime/deadline.js";
import { StageExecutor } from "../../src/stages/executor.js";
import { ApplicationInvocationJournal } from "../../src/app/journal.js";
import { buildContext } from "../../src/context/index.js";
import { UrlGateway } from "../../src/tools/fetch.js";
import type { Scope } from "../../src/stages/contracts.js";
import { parseDispatch } from "../../src/config/dispatch.js";

const policy: TrustedPolicy = {
  commit: "a".repeat(40),
  hash: "148de9c5a7a44d19e56cd9ae1a554bf67847afb0c58f6e12fa29ac7ddfca9940",
  semantic_policy_hash: "043a718774c572bd8a25adbeb1bfcd5c0256ae11cecf9f9c3f925d0e52beaf89",
  paused: false,
  paused_projects: [],
  sources: {},
  manual_url: { enabled: true },
  allowed_domains: ["example.org"],
  denied_domains: [],
  excluded_topics: [],
};
async function fixture(scope: Scope) {
  const root = await mkdtemp(join(tmpdir(), "reading-controller-"));
  const store = new FileObjectStore(join(root, "objects"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope,
    verify_preflight: false,
    local_root: join(root, "restore"),
  });
  const id =
    scope === "preview"
      ? "obs-notes-hub/reading-preview/test"
      : "obs-notes-hub/reading";
  const journal = new WorkspaceJournal(
    manager,
    await manager.restore(id, { allow_initialize: true }),
    "run1",
  );
  const gate = new PolicyGate(
    async () => policy,
    (check) => journal.commit(`policy-checks/${check.check_id}`, check),
  );
  const deadline = new RunDeadline();
  const executor = new StageExecutor(
    {
      async *stream() {
        throw new Error("unexpected_model_call");
      },
    },
    gate,
    new ApplicationInvocationJournal(journal),
  );
  const seen: string[] = [];
  const ports: ControllerPorts = {
    journal,
    gate,
    deadline,
    sources: [],
    context: async () =>
      buildContext({
        index: [],
        query: "test",
        heldout: { urls: new Set(), note_paths: new Set() },
        preferences_hash: "148de9c5a7a44d19e56cd9ae1a554bf67847afb0c58f6e12fa29ac7ddfca9940",
        skill_commit: "a".repeat(40),
        skill_hash: "043a718774c572bd8a25adbeb1bfcd5c0256ae11cecf9f9c3f925d0e52beaf89",
        prompt_hash: "aaa9402664f1a41f40ebbc52c9993eb66aeb366602958fdfaa283b71e64db123",
        model: "fixture",
        evidence_versions: [],
      }),
    environment: async (_project, commit) => ({
      root,
      model: "fixture",
      executor,
      gate,
      gateway: new UrlGateway(async () => {}),
      deadline,
      skills: null,
      commit,
    }),
    prepareResources: async (p) => p,
    verifySources: async () => new Date().toISOString(),
    seal: async () => {
      seen.push("seal");
    },
    reconcile: async (p) => p,
    publish: async (p) => {
      seen.push("publish");
      return { ...p, state: "pr_open" };
    },
    execute: async (project, stage) => {
      seen.push(stage);
      const files =
        stage === "writing"
          ? [
              {
                path: `projects/${project.project_id}/draft/Organize Notes By AI/test.md`,
                bytes: Buffer.from("fixture artifact"),
                role: "artifact" as const,
                project_id: project.project_id,
              },
            ]
          : [];
      return {
        project,
        decision: "complete",
        reason: null,
        files,
        validated: stage === "review",
      };
    },
  };
  return {
    root,
    store,
    manager,
    journal,
    ports,
    seen,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
describe("host lifecycle and durable mode boundaries", () => {
  it("refreshes expired classification before production resource upload and resumes review in the same batch", async () => {
    const f = await fixture("production");
    try {
      let refreshed = false;
      const base = f.ports.execute!;
      f.ports.prepareResources = async (project) => {
        expect(refreshed).toBe(true);
        f.seen.push("upload");
        return project;
      };
      f.ports.execute = async (project, stage, environment) => {
        if (stage === "review" && !refreshed) {
          refreshed = true;
          const binding = {
            candidate_id: project.candidate.candidate_id,
            source_snapshot_hash: "230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5",
            semantic_policy_hash: policy.semantic_policy_hash,
            attempts: 1,
            format_repairs: 0,
            pending: false,
            credential: {
              candidate_id: project.candidate.candidate_id,
              source_snapshot_hash: "230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5",
              semantic_policy_hash: policy.semantic_policy_hash,
              content_eligibility: "allowed" as const,
              evidence_hash: "3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea",
            },
          };
          return {
            project: { ...project, classification: binding },
            decision: "defer",
            reason: "classification_refreshed",
            resume_stage: "review",
            files: [],
            validated: false,
          };
        }
        return base(project, stage, environment);
      };
      await new ReadingController(f.ports).run(
        parseDispatch({
          mode: "scheduled",
          input_urls: ["https://example.org/a"],
        }),
        "operator",
      );
      expect(f.seen.indexOf("upload")).toBeGreaterThan(
        f.seen.indexOf("writing"),
      );
      expect(f.seen).toContain("publish");
    } finally {
      await f.cleanup();
    }
  });
  it("one manual request barrier leaves unrelated preview executable and reports partial progress with required operator action", async () => {
    const f = await fixture("preview");
    try {
      const execute = f.ports.execute!;
      f.ports.execute = async (project, stage, environment) =>
        project.candidate.url.endsWith("/blocked")
          ? {
              project,
              decision: "manual",
              reason: "request_unknown",
              files: [],
              validated: false,
            }
          : execute(project, stage, environment);
      const report = await new ReadingController(f.ports).run(
        parseDispatch({
          input_urls: [
            "https://example.org/blocked",
            "https://example.org/allowed",
          ],
        }),
        "user",
      );
      expect(report.outcome).toBe("partial");
      expect(report.blocked_projects).toHaveLength(1);
      expect(report.blocked_projects[0]).toMatchObject({
        reason: "request_unknown",
      });
      expect(
        report.delivery_results.some(
          (result) => result.state === "preview_ready",
        ),
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
  it('unavailable fixed runtime stops only its project and cold restart preserves the manual barrier',async()=>{
    const f=await fixture('preview');try{
      const environment=f.ports.environment;f.ports.environment=async(project,commit)=>{
        if(project.candidate.url.endsWith('/blocked'))throw new Error('fixed_runtime_version_unavailable:sdk_hash');
        return environment(project,commit);
      };
      const report=await new ReadingController(f.ports).run(parseDispatch({input_urls:['https://example.org/blocked','https://example.org/allowed']}),'user');
      expect(report.outcome).toBe('partial');expect(report.blocked_projects).toMatchObject([{reason:'fixed_runtime_version_unavailable'}]);
      const restored=await f.manager.restore(f.journal.handle.workspace_id);
      const projects=Object.entries(restored.records).filter(([key])=>key.startsWith('projects/')).map(([,value])=>value as unknown as HostProject);
      expect(projects.find(p=>p.candidate.url.endsWith('/blocked'))).toMatchObject({state:'deferred',resume_policy:'manual',reason:'fixed_runtime_version_unavailable',counters:{revisions:0}});
      expect(projects.find(p=>p.candidate.url.endsWith('/allowed'))?.state).toBe('preview_ready');
    }finally{await f.cleanup();}
  });
  it('same Beijing daily key groups separate physical runs without discarding a newly submitted URL',async()=>{
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-12T17:01:00Z'));
    const f=await fixture('preview');try{
      f.ports.now=()=>new Date('2026-10-12T17:01:00Z');
      const first=await new ReadingController(f.ports).run(parseDispatch({input_urls:['https://example.org/first']}),'user');
      const journal=new WorkspaceJournal(f.manager,await f.manager.restore(f.journal.handle.workspace_id),'run2');
      const gate=new PolicyGate(async()=>policy,check=>journal.commit(`policy-checks/${check.check_id}`,check));
      const environment=f.ports.environment;
      const second=await new ReadingController({...f.ports,journal,gate,environment:async(project,commit)=>({...await environment(project,commit),gate})}).run(parseDispatch({input_urls:['https://example.org/second']}),'user');
      expect(first.logical_key).toBe('obs-notes-hub:reading:2026-10-13:preview:test');expect(second.logical_key).toBe(first.logical_key);
      const restored=await f.manager.restore(journal.handle.workspace_id);
      const logical=Object.entries(restored.records).find(([key])=>key.startsWith('logical-runs/'))![1];expect(logical).toMatchObject({logical_key:first.logical_key,run_ids:['run1','run2']});
      const projects=Object.entries(restored.records).filter(([key])=>key.startsWith('projects/'));expect(projects).toHaveLength(2);expect(projects.every(([,p])=>(p as unknown as HostProject).state==='preview_ready')).toBe(true);
    }finally{await f.cleanup();clock.mockRestore();}
  });
  it("runs preview stages, seals private output and never calls Publisher", async () => {
    const f = await fixture("preview");
    try {
      const report = await new ReadingController(f.ports).run(
        parseDispatch({ input_urls: ["https://example.org/a"] }),
        "user",
      );
      expect(f.seen).toEqual(["selection", "research", "writing", "review"]);
      expect(report.outcome).toBe("success_preview");
      expect(
        f.journal.handle.snapshot.manifest.files.some((file) =>
          file.path.startsWith("outputs/"),
        ),
      ).toBe(true);
      const restored = await f.manager.restore(f.journal.handle.workspace_id);
      expect(restored.records["runs/run1"]).toMatchObject({
        outcome: "success_preview",
        mode: "preview",
      });
    } finally {
      await f.cleanup();
    }
  });
  it("records batch yield with stage and resumes without losing the candidate", async () => {
    const f = await fixture("preview");
    try {
      f.ports.execute = async (project) => ({
        project,
        decision: "batch_yield",
        reason: "batch_yield",
        files: [],
        validated: false,
      });
      await new ReadingController(f.ports).run(
        parseDispatch({ input_urls: ["https://example.org/a"] }),
        "user",
      );
      const project = (await f.journal.load<{
        candidates: Record<string, { project_id: string }>;
      }>("identity"))!;
      const id = Object.values(project.candidates)[0]!.project_id;
      expect(await f.journal.load(`projects/${id}`)).toMatchObject({
        state: "deferred",
        resume_stage: "selection",
        resume_policy: "automatic",
      });
    } finally {
      await f.cleanup();
    }
  });
  it("keeps publishing after an uncertain PR result and only reconciles on the next run", async () => {
    const f = await fixture("production");
    try {
      f.ports.publish = async () => {
        throw new Error("github_result_unknown");
      };
      await new ReadingController(f.ports).run(
        parseDispatch({
          mode: "scheduled",
          input_urls: ["https://example.org/a"],
        }),
        "user",
      );
      const key = f.journal.keys("projects/")[0]!;
      const project = (await f.journal.load<HostProject>(key))!;
      expect(project.state).toBe("publishing");
      const nextJournal = new WorkspaceJournal(
        f.manager,
        await f.manager.restore(project.workspace_id),
        "run2",
      );
      const effects: string[] = [];
      const nextPorts = {
        ...f.ports,
        journal: nextJournal,
        reconcile: async (p: HostProject) => {
          effects.push("reconcile");
          return p;
        },
        publish: async (p: HostProject) => {
          effects.push("publish");
          return p;
        },
      };
      await new ReadingController(nextPorts).run(
        parseDispatch({ mode: "scheduled" }),
        "user",
      );
      expect(effects).toEqual(["reconcile"]);
    } finally {
      await f.cleanup();
    }
  });
  it("publish-only performs no reading or model phases", async () => {
    const f = await fixture("production");
    try {
      f.ports.execute = async () => {
        throw new Error("must_not_read");
      };
      await expect(
        new ReadingController(f.ports).run(
          parseDispatch({ mode: "publish-only", project_id: "missing" }),
          "user",
        ),
      ).rejects.toThrow("existing_project_required");
      expect(f.seen).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { G1_REQUIRED_ASSERTIONS } from "../../src/storage/gates.js";
interface Job {
  needs?: string;
  if?: string;
  env?: Record<string, string>;
  steps: {
    name?: string;
    if?: string;
    uses?: string;
    run?: string;
    env?: Record<string, string>;
  }[];
}
interface Workflow {
  on: { schedule?: unknown; workflow_dispatch?: unknown };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, Job>;
}
const load = (name: string) =>
  parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as Workflow;
describe("Actions capability boundaries", () => {
  it("generation uses trusted environment G1 refs and publish-only omits model/image secrets and tool build", () => {
    const w = load("reading-agent");
    for (const profile of ["preview", "production", "integration"]) {
      const steps = w.jobs[profile]!.steps;
      const verify = steps.findIndex(s => s.name === "Verify trusted checked-in G1 evidence before generation");
      const host = steps.findIndex(s => s.name?.startsWith("Run "));
      expect(verify).toBeGreaterThan(-1);
      expect(host).toBeGreaterThan(verify);
      expect(steps[verify]?.if).toContain("inputs.mode != 'publish-only'");
      expect(steps[verify]?.env?.READING_G1_EVIDENCE_PATH).toBe("${{ vars.READING_G1_EVIDENCE_PATH }}");
      expect(steps[host]?.env?.READING_G1_EVIDENCE_SHA256).toBe("${{ vars.READING_G1_EVIDENCE_SHA256 }}");
      expect(steps.find(s => s.name === "Build fixed tool container without credentials")?.if).toContain("inputs.mode != 'publish-only'");
      expect(steps[host]?.env?.DEEPSEEK_API_KEY).toContain("inputs.mode != 'publish-only'");
      const imageKey = profile === "production" ? "OSS_IMAGE_CREDENTIALS" : "OSS_TEST_IMAGE_CREDENTIALS";
      if (profile !== "preview") expect(steps[host]?.env?.[imageKey]).toContain("inputs.mode != 'publish-only'");
    }
  });
  it("executes the actual workflow evidence check against committed, changed, untracked and incomplete files", async () => {
    const step = load("reading-agent").jobs.preview!.steps.find(s => s.name === "Verify trusted checked-in G1 evidence before generation")!;
    const script = step.run!.split("<<'NODE'\n")[1]!.replace(/\nNODE\s*$/, "")
      .replace("'./agents/reading/src/storage/gates.ts'", JSON.stringify(pathToFileURL(resolve("agents/reading/src/storage/gates.ts")).href));
    const root = await mkdtemp(join(tmpdir(), "reading-workflow-g1-"));
    const path = "agents/reading/evals/integration/evidence/g1.json";
    const evidence = { schema_version: 1, gate: "G1", status: "complete", isolated_resources: true,
      sdk: "ali-oss@6.23.0", observed_at: "2026-10-13T00:00:00Z",
      assertions: Object.fromEntries(G1_REQUIRED_ASSERTIONS.map(k => [k, "passed"])) };
    const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    const run = (content: string, selected = path) => execFileSync(process.execPath,
      ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, "--input-type=module", "--eval", script],
      { cwd: root, stdio: "pipe", env: { PATH: process.env.PATH,
        READING_G1_EVIDENCE_PATH: selected,
        READING_G1_EVIDENCE_SHA256: createHash("sha256").update(content).digest("hex") } });
    try {
      git(["init", "--quiet"]);
      git(["config", "user.email", "test@example.com"]); git(["config", "user.name", "Test"]);
      await mkdir(join(root, "agents/reading/evals/integration/evidence"), { recursive: true });
      const complete = JSON.stringify(evidence);
      await writeFile(join(root, path), complete);
      git(["add", "."]); git(["commit", "--quiet", "-m", "isolated fake proof fixture"]);
      expect(() => run(complete)).not.toThrow();
      await writeFile(join(root, path), complete + "\n");
      expect(() => run(complete + "\n")).toThrow(); // even a matching hash cannot override HEAD
      await writeFile(join(root, path), complete);
      await writeFile(join(root, "agents/reading/evals/integration/evidence/untracked.json"), complete);
      expect(() => run(complete, "agents/reading/evals/integration/evidence/untracked.json")).toThrow();
      const incomplete = JSON.stringify({ ...evidence, status: "incomplete" });
      await writeFile(join(root, path), incomplete);
      git(["add", path]); git(["commit", "--quiet", "-m", "incomplete fixture"]);
      expect(() => run(incomplete)).toThrow();
      expect(() => run(incomplete, "agents/reading/evals/../../outside.json")).toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("recovery is audited metadata only, shares the writer mutex and never receives SDK or delivery write credentials", () => {
    const workflow = load("reading-recovery");
    expect(workflow.concurrency).toEqual(load("reading-agent").concurrency);
    expect(workflow.on.schedule).toBeUndefined();
    expect(workflow.jobs.recover?.if).toContain("default_branch");
    const data = JSON.stringify(workflow.jobs);
    for (const secret of [
      "DEEPSEEK_API_KEY",
      "ANTHROPIC_API_KEY",
      "READING_GITHUB_APP",
      "TEST_GITHUB_APP",
      "OSS_IMAGE_CREDENTIALS",
      "OSS_TEST_IMAGE_CREDENTIALS",
    ])
      expect(data).not.toContain(secret);
    for (const step of workflow.jobs.recover!.steps)
      if (step.run) expect(step.run).not.toContain("${{ inputs.");
  });
  it("maintenance shares the writer mutex and does not receive generation or image write secrets", () => {
    const w = load("reading-maintenance");
    expect(w.concurrency).toEqual(load("reading-agent").concurrency);
    expect(w.on.schedule).toBeUndefined();
    expect(w.jobs.cleanup?.if).toContain("default_branch");
    const encoded = JSON.stringify(w.jobs);
    for (const secret of [
      "DEEPSEEK_API_KEY",
      "ANTHROPIC_API_KEY",
      "OSS_IMAGE_CREDENTIALS",
      "OSS_TEST_IMAGE_CREDENTIALS",
    ])
      expect(encoded).not.toContain(secret);
    expect(encoded).toContain("READING_SHARED_MUTEX_HELD");
  });
  it("keeps production cron absent and serializes every writer under one fixed group", () => {
    const w = load("reading-agent");
    expect(w.on.schedule).toBeUndefined();
    expect(w.concurrency).toEqual({
      group: "reading-workspace-writer",
      "cancel-in-progress": false,
    });
    for (const role of ["preview", "production", "integration"]) {
      expect(w.jobs[role]?.needs).toBe("validate");
      expect(w.jobs[role]?.if).toContain("default_branch");
    }
    expect(JSON.stringify(w.jobs.validate)).not.toContain("secrets.");
  });
  it("preview only receives preview/model/read capability and validates before secret injection", () => {
    const w = load("reading-agent");
    const steps = w.jobs.preview!.steps;
    const validate = steps.findIndex(
      (s) => s.name === "Validate scope without secrets",
    );
    const secret = steps.findIndex((s) => s.name === "Run isolated preview");
    expect(validate).toBeGreaterThan(-1);
    expect(secret).toBeGreaterThan(validate);
    const encoded = JSON.stringify(steps[secret]!.env);
    for (const forbidden of [
      "OSS_WORKSPACE_CREDENTIALS",
      "OSS_IMAGE_CREDENTIALS",
      "READING_GITHUB_APP",
      "WATCHDOG_GITHUB_TOKEN",
    ])
      expect(encoded).not.toContain(forbidden);
    expect(w.jobs.preview?.env?.READING_MODE).toBe("preview");
  });
  it("pins reusable actions and keeps raw user URL JSON out of executable shell", () => {
    const w = load("reading-agent");
    for (const job of Object.values(w.jobs))
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        if (step.run) expect(step.run).not.toContain("${{ inputs.");
      }
    expect(w.jobs.production?.env?.READING_INPUT_URLS_JSON).toContain(
      "inputs.input_urls",
    );
  });
  it("watchdog independently holds only readonly reports and implementation Issue capability", () => {
    const w = load("reading-watchdog");
    expect(w.concurrency.group).toBe("reading-watchdog-issues");
    expect(w.permissions).toEqual({
      contents: "read",
      actions: "read",
      issues: "write",
    });
    expect(w.on.schedule).toEqual([{ cron: "47 2,14 * * *" }]);
    const encoded = JSON.stringify(w.jobs);
    for (const forbidden of [
      "ANTHROPIC_API_KEY",
      "DEEPSEEK_API_KEY",
      "OSS_IMAGE_CREDENTIALS",
      "OSS_WORKSPACE_CREDENTIALS",
      "READING_GITHUB_APP",
    ])
      expect(encoded).not.toContain(forbidden);
  });
});

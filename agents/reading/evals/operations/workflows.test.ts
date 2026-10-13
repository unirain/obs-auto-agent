import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
interface Job {
  needs?: string;
  if?: string;
  env?: Record<string, string>;
  steps: {
    name?: string;
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
  it("maintenance shares the writer mutex and does not receive generation or image write secrets", () => {
    const w=load("reading-maintenance");
    expect(w.concurrency).toEqual(load("reading-agent").concurrency);
    expect(w.on.schedule).toBeUndefined();
    expect(w.jobs.cleanup?.if).toContain("default_branch");
    const encoded=JSON.stringify(w.jobs);
    for(const secret of ["DEEPSEEK_API_KEY","ANTHROPIC_API_KEY","OSS_IMAGE_CREDENTIALS","OSS_TEST_IMAGE_CREDENTIALS"])expect(encoded).not.toContain(secret);
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

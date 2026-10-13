import { expect, it } from "vitest";
import {
  checkGenerationReadiness,
  type GenerationReadinessPort,
  type GitHubReadAuthority,
  type ProjectRemoteSnapshot,
} from "../../src/publish/regeneration.js";
import type {
  DeliveryRecord,
  GitHubFact,
  PullRequestFact,
} from "../../src/publish/types.js";
import { sealed, FakeGitHub } from "./helpers.js";
import { canonicalJson, sha256 } from "../../src/contracts/index.js";
const authority = (): GitHubReadAuthority => ({
  schema_version: 1,
  complete: true,
  repository: "test/repo",
  default_branch: "main",
  default_commit_sha: "a".repeat(40),
  checked_at: "2026-10-13T00:00:00Z",
});
class ReadPort implements GenerationReadinessPort {
  branches: { ref: string; sha: string }[] = [];
  prs: PullRequestFact[] = [];
  facts = new Map<string, GitHubFact>();
  reads: string[] = [];
  failure: string | null = null;
  changing = false;
  snapshots = 0;
  async authority() {
    this.reads.push("authority");
    if (this.failure === "authority") throw new Error("API unavailable");
    return authority();
  }
  async projectSnapshot(projectId: string): Promise<ProjectRemoteSnapshot> {
    this.reads.push("project");
    if (this.failure === "project") throw new Error("request response lost");
    const base = authority();
    if (this.changing && ++this.snapshots > 1)
      base.default_commit_sha = "b".repeat(40);
    return {
      ...base,
      project_id: projectId,
      branch_heads: structuredClone(this.branches),
      prs: structuredClone(this.prs),
    };
  }
  async inspect(d: ReturnType<typeof sealed>): Promise<GitHubFact> {
    this.reads.push(d.delivery_id);
    if (this.failure === d.delivery_id) throw new Error("read failed");
    return (
      this.facts.get(d.delivery_id) ?? {
        observation: { ...authority(), project_id: d.project_id },
        prs: [],
        branch_sha: null,
        expected_commit_exists: false,
        complete_diff_matches: false,
        default_branch_duplicate: false,
        pending_duplicate: false,
      }
    );
  }
}
const record = (id: string, generation = 1): DeliveryRecord => ({
  schema_version: 1,
  delivery_id: id,
  project_id: "p1",
  generation_version: generation,
  branch: `notes/p1/g${generation}`,
  status: "publishing",
  prepared: null,
  pr: null,
  uncertain_action: null,
  reason: null,
  updated_at: "2026-10-13T00:00:00Z",
});
const input = (github: ReadPort) => ({
  github,
  repository: "test/repo",
  workspace_id: sealed().workspace_id,
  project_id: "p1",
  expected_delivery_ids: ["d1", "d2"],
  history: [
    { seal: sealed(), record: record("d1") },
    {
      seal: sealed({ delivery_id: "d2", generation_version: 2 }),
      record: record("d2", 2),
    },
  ],
  now: () => new Date("2026-10-13T01:00:00Z"),
});
it("reads every immutable historical generation and double-checks project refs before returning hashed audit permission", async () => {
  const p = new ReadPort();
  const result = await checkGenerationReadiness(input(p));
  expect(result.status).toBe("allowed");
  expect(result.complete).toBe(true);
  expect(p.reads).toEqual(["authority", "project", "d1", "d2", "project"]);
  expect(result.authority?.repository).toBe("test/repo");
  expect(result.deliveries).toHaveLength(2);
  const { audit_hash, ...body } = result;
  expect(audit_hash).toBe(sha256(canonicalJson(body)));
});
it.each(["d1", "d2", "authority", "project"])(
  "read uncertainty %s never becomes absent or allowed",
  async (fault) => {
    const p = new ReadPort();
    p.failure = fault;
    const result = await checkGenerationReadiness(input(p));
    expect(result).toMatchObject({ status: "blocked", complete: false });
    expect(result.reason_codes).toContain(
      "remote_read_unavailable_or_incomplete",
    );
  },
);
it.each(["open", "closed_unmerged", "merged"] as const)(
  "every historical %s PR blocks replacement, including manual PR discovered by the next fresh check",
  async (state) => {
    const p = new ReadPort();
    expect((await checkGenerationReadiness(input(p))).status).toBe("allowed");
    p.prs = [
      {
        number: 9,
        url: "https://github.com/test/repo/pull/9",
        state,
        branch: "notes/p1/g1",
        head_sha: "c".repeat(40),
        delivery_id: "d1",
      },
    ];
    const result = await checkGenerationReadiness(input(p));
    expect(result.reason_codes).toContain("historical_pr_exists");
    expect(result.status).toBe("blocked");
  },
);
it("a matched expected branch may be retained, while unknown writes, human changes and untracked old branches are refused", async () => {
  const p = new ReadPort();
  const args = input(p);
  const prepared = await new FakeGitHub().prepare(args.history[0]!.seal);
  args.history[0]!.record.prepared = prepared;
  p.branches = [{ ref: "refs/heads/notes/p1/g1", sha: prepared.commit_sha }];
  p.facts.set("d1", {
    observation: { ...authority(), project_id: "p1" },
    prs: [],
    branch_sha: prepared.commit_sha,
    expected_commit_exists: true,
    complete_diff_matches: true,
    default_branch_duplicate: false,
  });
  expect((await checkGenerationReadiness(args)).status).toBe("allowed");
  args.history[0]!.record.uncertain_action = "create_pr";
  expect((await checkGenerationReadiness(args)).reason_codes).toContain(
    "historical_remote_write_unresolved",
  );
  args.history[0]!.record.uncertain_action = null;
  p.branches.push({ ref: "refs/heads/notes/p1/g9", sha: "9".repeat(40) });
  expect((await checkGenerationReadiness(args)).reason_codes).toContain(
    "untracked_project_branch",
  );
  p.branches.pop();
  p.facts.get("d1")!.complete_diff_matches = false;
  expect((await checkGenerationReadiness(args)).reason_codes).toContain(
    "historical_branch_not_exactly_verified",
  );
});
it("incomplete local history, missing real inspection observation and moving default refs cannot authorize a new generation", async () => {
  const p = new ReadPort();
  expect(
    (
      await checkGenerationReadiness({
        ...input(p),
        expected_delivery_ids: ["d1", "d2", "missing"],
      })
    ).reason_codes,
  ).toContain("historical_delivery_set_incomplete");
  p.facts.set("d1", {
    prs: [],
    branch_sha: null,
    expected_commit_exists: false,
    complete_diff_matches: false,
    default_branch_duplicate: false,
  });
  expect((await checkGenerationReadiness(input(p))).complete).toBe(false);
  p.facts.clear();
  p.changing = true;
  expect((await checkGenerationReadiness(input(p))).reason_codes).toContain(
    "remote_project_references_changed",
  );
});
it("even no known delivery requires a real repository/project snapshot, and any external old branch blocks", async () => {
  const p = new ReadPort();
  const args = { ...input(p), expected_delivery_ids: [], history: [] };
  expect((await checkGenerationReadiness(args)).status).toBe("allowed");
  p.branches = [{ ref: "refs/heads/notes/p1/g1", sha: "1".repeat(40) }];
  expect((await checkGenerationReadiness(args)).reason_codes).toContain(
    "untracked_project_branch",
  );
});

it("unknown schema-one state and missing/empty uncertainty fields cannot turn history into permission", async () => {
  const p = new ReadPort();
  const args = input(p);
  args.history[0]!.record.status = "future_closed" as DeliveryRecord["status"];
  expect((await checkGenerationReadiness(args)).reason_codes).toContain(
    "historical_record_identity_or_schema_invalid",
  );
  args.history[0]!.record = record("d1");
  args.history[0]!.record.uncertain_action = "";
  expect((await checkGenerationReadiness(args)).reason_codes).toContain(
    "historical_remote_write_unresolved",
  );
});

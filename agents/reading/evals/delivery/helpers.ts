import { createHash } from "node:crypto";
import type {
  OperationsJournal,
  SealedDelivery,
  GitHubPort,
  PreparedCommit,
  GitHubFact,
  PullRequestFact,
} from "../../src/publish/types.js";
import { sha256, deliveryValidationHash } from "../../src/publish/validate.js";
export class MemoryJournal implements OperationsJournal {
  data = new Map<string, unknown>();
  fail: string | null = null;
  async load<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async commitMany(records: Record<string, unknown>): Promise<void> {
    if (this.fail && Object.keys(records).includes(this.fail))
      throw new Error("checkpoint_unknown");
    for (const [key, value] of Object.entries(records))
      this.data.set(key, structuredClone(value));
  }
  async commit<T>(key: string, value: T): Promise<void> {
    if (this.fail === key) throw new Error("checkpoint_unknown");
    this.data.set(key, structuredClone(value));
  }
}
export function sealed(
  overrides: Partial<SealedDelivery> = {},
): SealedDelivery {
  const content = Buffer.from(
    "# Mechanism\n\nEvidence: https://example.com/article\n",
  );
  const d: SealedDelivery = {
    schema_version: 1,
    delivery_id: "d1",
    execution_scope: "production",
    workspace_id: "obs-notes-hub/reading-integration",
    project_id: "p1",
    generation_version: 1,
    workspace_revision: "a".repeat(64),
    context_id: "context1",
    base_commit: "b".repeat(40),
    sources_verified_at: "2026-10-13T00:00:00Z",
    files: [
      {
        path: "Organize Notes By AI/note.md",
        role: "note",
        mime: "text/markdown",
        bytes: content.byteLength,
        sha256: sha256(content),
        content,
      },
    ],
    resources: [],
    sources: ["https://example.com/article"],
    quality_report: { passed: true },
    rationale: "mechanism",
    knowledge_increment: "new evidence",
    gaps: [],
    image_degradations: [],
    usage: { status: "unknown", estimated_usd: null },
    warnings: [],
    validated_hash: "",
    ...overrides,
  };
  d.validated_hash = deliveryValidationHash(d);
  return d;
}
export class FakeGitHub implements GitHubPort {
  pr: PullRequestFact | null = null;
  branch: string | null = null;
  commit = false;
  duplicate = false;
  failure: "objects" | "branch" | "pr" | "read" | null = null;
  calls: string[] = [];
  async prepare(d: SealedDelivery): Promise<PreparedCommit> {
    return {
      base_commit: d.base_commit,
      base_tree: "c".repeat(40),
      tree_sha: "d".repeat(40),
      commit_sha: "e".repeat(40),
      message: "reading",
      identity: {
        name: "Bot",
        email: "bot@example.com",
        date: "2026-10-13T00:00:00Z",
      },
      blobs: d.files.map((f) => ({
        path: f.path,
        sha: (() => {
          const bytes = Buffer.from(f.content);
          return createHash("sha1")
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest("hex");
        })(),
        content_base64: Buffer.from(f.content).toString("base64"),
      })),
      files: d.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    };
  }
  async inspect(_d: SealedDelivery, p?: PreparedCommit): Promise<GitHubFact> {
    if (this.failure === "read") throw new Error("read unavailable");
    return {
      prs: this.pr ? [this.pr] : [],
      branch_sha: this.branch,
      expected_commit_exists: this.commit,
      complete_diff_matches:
        this.commit && (this.branch === null || this.branch === p?.commit_sha),
      default_branch_duplicate: this.duplicate,
    };
  }
  async materialize(
    p: PreparedCommit,
    before: () => Promise<void>,
  ): Promise<void> {
    await before();
    this.calls.push("objects");
    this.commit = true;
    if (this.failure === "objects") throw new Error("object response lost");
  }
  async createBranch(_branch: string, sha: string): Promise<void> {
    this.calls.push("branch");
    this.branch = sha;
    if (this.failure === "branch") throw new Error("branch response lost");
  }
  async createPR(
    branch: string,
    _title: string,
    body: string,
  ): Promise<PullRequestFact> {
    this.calls.push("pr");
    this.pr = {
      number: 1,
      url: "https://github.com/test/repo/pull/1",
      state: "open",
      branch,
      head_sha: this.branch!,
      delivery_id: /reading-delivery:([\w-]+)/.exec(body)?.[1] ?? null,
    };
    if (this.failure === "pr") throw new Error("PR response lost");
    return this.pr;
  }
}

import { isUtcInstant } from "../contracts/utc.js";
import { parsePullRequestFact } from "./contracts.js";
import { samePrimarySource } from "./primary-source.js";
import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import type {
  GitHubFact,
  GitHubPort,
  GitIdentity,
  PreparedCommit,
  PullRequestFact,
  SealedDelivery,
} from "./types.js";
import { branchFor } from "./types.js";
import { sha256 } from "./validate.js";
export const gitObjectSHA = (
  kind: "blob" | "tree" | "commit",
  bytes: Uint8Array | string,
): string => {
  const data = Buffer.from(bytes);
  return createHash("sha1")
    .update(`${kind} ${data.length}\0`)
    .update(data)
    .digest("hex");
};
export function gitCommitContent(
  tree: string,
  parent: string,
  identity: GitIdentity,
  message: string,
): string {
  if (
    /[\n<>]/.test(identity.name) ||
    /[\n<>]/.test(identity.email) ||
    !isUtcInstant(identity.date)
  )
    throw new Error("Unsafe Git identity");
  const seconds = Math.floor(Date.parse(identity.date) / 1000);
  return `tree ${tree}\nparent ${parent}\nauthor ${identity.name} <${identity.email}> ${seconds} +0000\ncommitter ${identity.name} <${identity.email}> ${seconds} +0000\n\n${message}\n`;
}
interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}
/** Rebuild changed trees locally without performing a GitHub write before durable intent. */
export function overlayTreeSHA(
  entries: TreeEntry[],
  additions: { path: string; sha: string }[],
): string {
  const all = new Map(
    entries
      .filter((e) => e.type !== "tree")
      .map((e) => [e.path, { mode: e.mode, sha: e.sha }]),
  );
  for (const a of additions) all.set(a.path, { mode: "100644", sha: a.sha });
  const build = (directory: string): string => {
    const children = new Map<
      string,
      { mode: string; sha: string; directory: boolean }
    >();
    for (const [path, value] of all) {
      if (!path.startsWith(directory)) continue;
      const remaining = path.slice(directory.length);
      const slash = remaining.indexOf("/");
      if (slash === -1) children.set(remaining, { ...value, directory: false });
      else {
        const name = remaining.slice(0, slash);
        if (!children.has(name))
          children.set(name, {
            mode: "40000",
            sha: build(`${directory}${name}/`),
            directory: true,
          });
      }
    }
    const buffers = [...children]
      .sort(([a, av], [b, bv]) =>
        Buffer.compare(
          Buffer.from(a + (av.directory ? "/" : "")),
          Buffer.from(b + (bv.directory ? "/" : "")),
        ),
      )
      .map(([name, v]) =>
        Buffer.concat([
          Buffer.from(`${v.mode} ${name}\0`),
          Buffer.from(v.sha, "hex"),
        ]),
      );
    return gitObjectSHA("tree", Buffer.concat(buffers));
  };
  return build("");
}
export function parseDeliveryMarker(
  body: string | null | undefined,
): { delivery_id: string; project_id: string } | null {
  const match =
    /^<!-- reading-delivery:([A-Za-z0-9_-]+) project:([A-Za-z0-9_-]+) -->\r?\n/.exec(
      (body ?? "") + "\n",
    );
  return match ? { delivery_id: match[1]!, project_id: match[2]! } : null;
}
const missing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;
export class OctokitGitHub implements GitHubPort {
  private owner: string;
  private repo: string;
  constructor(
    private client: Octokit,
    repository: string,
    private defaultBranch: string,
  ) {
    const parts = repository.split("/");
    if (parts.length !== 2 || !parts.every((x) => /^[\w.-]+$/.test(x)))
      throw new Error("Invalid trusted repository");
    this.owner = parts[0]!;
    this.repo = parts[1]!;
  }
  private args(): { owner: string; repo: string } {
    return { owner: this.owner, repo: this.repo };
  }
  private async tree(
    commit: string,
  ): Promise<{ tree: TreeEntry[]; sha: string }> {
    const data = (
      await this.client.git.getCommit({ ...this.args(), commit_sha: commit })
    ).data;
    const result = (
      await this.client.git.getTree({
        ...this.args(),
        tree_sha: data.tree.sha,
        recursive: "1",
      })
    ).data;
    if (
      result.truncated ||
      result.tree.some((e) => !e.path || !e.mode || !e.type || !e.sha)
    )
      throw new Error("Incomplete Git tree");
    return { tree: result.tree as TreeEntry[], sha: data.tree.sha };
  }
  async inspectPullRequest(number: number): Promise<PullRequestFact> {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error("Invalid actual PR identity");
    const p = (
      await this.client.pulls.get({ ...this.args(), pull_number: number })
    ).data;
    if (!["open", "closed"].includes(p.state))
      throw new Error("Unknown actual PR state");
    return parsePullRequestFact({
      number: p.number,
      url: p.html_url,
      state: p.merged
        ? "merged"
        : p.state === "open"
          ? "open"
          : "closed_unmerged",
      branch: p.head.ref,
      head_sha: p.head.sha,
      delivery_id: parseDeliveryMarker(p.body)?.delivery_id ?? null,
      created_at: p.created_at,
      closed_at: p.closed_at,
      merged_at: p.merged_at,
    });
  }
  async authority(): Promise<import("./regeneration.js").GitHubReadAuthority> {
    const metadata = (await this.client.repos.get(this.args())).data;
    if (
      metadata.full_name.toLowerCase() !==
        `${this.owner}/${this.repo}`.toLowerCase() ||
      metadata.default_branch !== this.defaultBranch
    )
      throw new Error("Trusted publication repository/default branch changed");
    const head = (
      await this.client.git.getRef({
        ...this.args(),
        ref: `heads/${metadata.default_branch}`,
      })
    ).data.object.sha;
    return {
      schema_version: 1,
      complete: true,
      repository: metadata.full_name,
      default_branch: metadata.default_branch,
      default_commit_sha: head,
      checked_at: new Date().toISOString(),
    };
  }
  async projectSnapshot(
    projectId: string,
  ): Promise<import("./regeneration.js").ProjectRemoteSnapshot> {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId))
      throw new Error("Invalid project identity for readonly snapshot");
    const before = await this.authority();
    const prefix = `notes/${projectId}/g`;
    const refs = await this.client.git.listMatchingRefs({
      ...this.args(),
      ref: `heads/${prefix}`,
    });
    const branch_heads = refs.data
      .filter((r) => r.ref.startsWith(`refs/heads/${prefix}`))
      .map((r) => {
        if (r.object.type !== "commit" || !/^[a-f0-9]{40}$/.test(r.object.sha))
          throw new Error("Invalid project reference response");
        return { ref: r.ref, sha: r.object.sha };
      });
    const all = await this.client.paginate(this.client.pulls.list, {
      ...this.args(),
      state: "all",
      per_page: 100,
    });
    const prs: PullRequestFact[] = [];
    for (const p of all.filter(
      (p) =>
        p.head.ref.startsWith(prefix) ||
        parseDeliveryMarker(p.body)?.project_id === projectId,
    )) {
      const full = (
        await this.client.pulls.get({ ...this.args(), pull_number: p.number })
      ).data;
      if (!["open", "closed"].includes(full.state))
        throw new Error("Unknown PR state in readonly snapshot");
      prs.push(
        parsePullRequestFact({
          number: full.number,
          url: full.html_url,
          state: full.merged
            ? "merged"
            : full.state === "open"
              ? "open"
              : "closed_unmerged",
          branch: full.head.ref,
          head_sha: full.head.sha,
          delivery_id: parseDeliveryMarker(full.body)?.delivery_id ?? null,
          created_at: full.created_at,
          closed_at: full.closed_at,
          merged_at: full.merged_at,
        }),
      );
    }
    const after = await this.authority();
    return {
      ...after,
      complete:
        before.default_commit_sha === after.default_commit_sha &&
        before.default_branch === after.default_branch,
      project_id: projectId,
      branch_heads,
      prs,
    };
  }
  async prepare(
    d: SealedDelivery,
    identity: GitIdentity,
  ): Promise<PreparedCommit> {
    const base = await this.tree(d.base_commit);
    if (d.files.some((f) => base.tree.some((e) => e.path === f.path)))
      throw new Error("Target filename already exists");
    const blobs = d.files.map((f) => ({
      path: f.path,
      sha: gitObjectSHA("blob", f.content),
      content_base64: Buffer.from(f.content).toString("base64"),
    }));
    const tree_sha = overlayTreeSHA(base.tree, blobs);
    const message = `Reading note ${d.project_id}\n\nreading-delivery:${d.delivery_id}`;
    const commit_sha = gitObjectSHA(
      "commit",
      gitCommitContent(tree_sha, d.base_commit, identity, message),
    );
    return {
      base_commit: d.base_commit,
      base_tree: base.sha,
      tree_sha,
      commit_sha,
      identity,
      message,
      blobs,
      files: d.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    };
  }
  async inspect(
    d: SealedDelivery,
    prepared?: PreparedCommit,
  ): Promise<GitHubFact> {
    const branch = branchFor(d);
    const prefix = `notes/${d.project_id}/g`;
    const all = await this.client.paginate(this.client.pulls.list, {
      ...this.args(),
      state: "all",
      per_page: 100,
    });
    const prs: PullRequestFact[] = [];
    for (const p of all.filter(
      (p) =>
        p.head.ref.startsWith(prefix) ||
        parseDeliveryMarker(p.body)?.project_id === d.project_id,
    )) {
      const full = (
        await this.client.pulls.get({ ...this.args(), pull_number: p.number })
      ).data;
      prs.push(
        parsePullRequestFact({
          number: full.number,
          url: full.html_url,
          state: full.merged
            ? "merged"
            : full.state === "open"
              ? "open"
              : "closed_unmerged",
          branch: full.head.ref,
          head_sha: full.head.sha,
          delivery_id: parseDeliveryMarker(full.body)?.delivery_id ?? null,
          created_at: full.created_at,
          closed_at: full.closed_at,
          merged_at: full.merged_at,
        }),
      );
    }
    let branch_sha: string | null = null;
    try {
      branch_sha = (
        await this.client.git.getRef({ ...this.args(), ref: `heads/${branch}` })
      ).data.object.sha;
    } catch (e) {
      if (!missing(e)) throw e;
    }
    let expected_commit_exists = false;
    let complete_diff_matches = false;
    if (prepared) {
      try {
        const commit = (
          await this.client.git.getCommit({
            ...this.args(),
            commit_sha: prepared.commit_sha,
          })
        ).data;
        expected_commit_exists = true;
        if (
          commit.tree.sha !== prepared.tree_sha ||
          commit.parents.length !== 1 ||
          commit.parents[0]?.sha !== prepared.base_commit
        )
          throw new Error("Expected commit metadata conflict");
        const compare = (
          await this.client.repos.compareCommitsWithBasehead({
            ...this.args(),
            basehead: `${prepared.base_commit}...${prepared.commit_sha}`,
          })
        ).data;
        complete_diff_matches =
          compare.files?.length === prepared.files.length &&
          compare.files.every(
            (file) =>
              file.status === "added" &&
              prepared.blobs.some(
                (b) => b.path === file.filename && b.sha === file.sha,
              ),
          ) === true &&
          compare.total_commits === 1;
        if (branch_sha !== null && branch_sha !== prepared.commit_sha)
          complete_diff_matches = false;
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    const defaultSHA = (
      await this.client.git.getRef({
        ...this.args(),
        ref: `heads/${this.defaultBranch}`,
      })
    ).data.object.sha;
    const current = await this.tree(defaultSHA);
    let default_branch_duplicate = d.files.some((f) =>
      current.tree.some((e) => e.path === f.path),
    );
    if (!default_branch_duplicate) {
      for (const e of current.tree.filter(
        (e) =>
          e.type === "blob" &&
          e.path.startsWith("Organize Notes By AI/") &&
          e.path.endsWith(".md"),
      )) {
        const blob = (
          await this.client.git.getBlob({ ...this.args(), file_sha: e.sha })
        ).data;
        const body = Buffer.from(
          blob.content.replace(/\n/g, ""),
          "base64",
        ).toString("utf8");
        if (samePrimarySource(body, d)) {
          default_branch_duplicate = true;
          break;
        }
      }
    }
    let pending_duplicate = false;
    for (const p of all.filter(
      (p) =>
        p.state === "open" &&
        !p.head.ref.startsWith(prefix) &&
        parseDeliveryMarker(p.body)?.project_id !== d.project_id,
    )) {
      const pending = await this.tree(p.head.sha);
      if (
        d.files.some((f) =>
          pending.tree.some((e) => e.path === f.path && e.type === "blob"),
        )
      ) {
        pending_duplicate = true;
        break;
      }
      for (const note of pending.tree.filter(
        (e) =>
          e.type === "blob" &&
          e.path.startsWith("Organize Notes By AI/") &&
          e.path.endsWith(".md"),
      )) {
        const blob = (
          await this.client.git.getBlob({ ...this.args(), file_sha: note.sha })
        ).data;
        const body = Buffer.from(
          blob.content.replace(/\n/g, ""),
          "base64",
        ).toString("utf8");
        if (samePrimarySource(body, d)) {
          pending_duplicate = true;
          break;
        }
      }
      if (pending_duplicate) break;
    }
    const merged_notes: { path: string; content: string; sha: string }[] = [];
    if (prs.some((p) => p.state === "merged")) {
      for (const f of d.files.filter((f) => f.role === "note")) {
        const e = current.tree.find(
          (e) => e.path === f.path && e.type === "blob",
        );
        if (!e)
          throw new Error("Merged note missing from current default branch");
        const blob = (
          await this.client.git.getBlob({ ...this.args(), file_sha: e.sha })
        ).data;
        merged_notes.push({
          path: f.path,
          content: Buffer.from(
            blob.content.replace(/\n/g, ""),
            "base64",
          ).toString("utf8"),
          sha: e.sha,
        });
      }
    }
    let review_outcome: import("./types.js").GitHubFact["review_outcome"];
    const own = prs.find(
      (p) => p.delivery_id === d.delivery_id || p.branch === branch,
    );
    if (own?.state === "merged") {
      const mergedHead = await this.tree(own.head_sha);
      const changed = d.files.some(
        (f) =>
          mergedHead.tree.find((e) => e.path === f.path && e.type === "blob")
            ?.sha !== gitObjectSHA("blob", f.content),
      );
      review_outcome = changed
        ? "accepted_with_changes"
        : "accepted_without_changes";
    } else if (own)
      review_outcome = own.state === "closed_unmerged" ? "rejected" : "pending";
    return {
      observation: {
        schema_version: 1,
        complete: true,
        repository: `${this.owner}/${this.repo}`,
        default_branch: this.defaultBranch,
        default_commit_sha: defaultSHA,
        project_id: d.project_id,
        checked_at: new Date().toISOString(),
      },
      prs,
      ...(review_outcome ? { review_outcome } : {}),
      branch_sha,
      expected_commit_exists,
      complete_diff_matches,
      default_branch_duplicate,
      pending_duplicate,
      ...(merged_notes.length ? { merged_notes } : {}),
    };
  }
  /** Read every Markdown note on the actual default branch and every open PR head before image cleanup. */
  async imageReferences(): Promise<
    import("./image-gc.js").RemoteImageReferences
  > {
    const defaultSHA = (
      await this.client.git.getRef({
        ...this.args(),
        ref: `heads/${this.defaultBranch}`,
      })
    ).data.object.sha;
    const prs = await this.client.paginate(this.client.pulls.list, {
      ...this.args(),
      state: "open",
      per_page: 100,
    });
    const heads = [
      { number: 0, sha: defaultSHA },
      ...prs.map((p) => ({ number: p.number, sha: p.head.sha })),
    ];
    const urls = new Set<string>();
    const blobs = new Map<string, string>();
    for (const head of heads) {
      const tree = await this.tree(head.sha); // Truncated/inaccessible heads fail closed.
      for (const file of tree.tree.filter(
        (e) =>
          e.type === "blob" &&
          /\.(?:md|markdown|svg|drawio|mmd|json|html|htm|canvas)$/i.test(
            e.path,
          ),
      )) {
        let text = blobs.get(file.sha);
        if (text === undefined) {
          const blob = (
            await this.client.git.getBlob({
              ...this.args(),
              file_sha: file.sha,
            })
          ).data;
          if (blob.encoding !== "base64")
            throw new Error("Unexpected GitHub reference blob encoding");
          text = Buffer.from(
            blob.content.replace(/\n/g, ""),
            "base64",
          ).toString("utf8");
          blobs.set(file.sha, text);
        }
        for (const match of text.matchAll(/https?:\/\/[^\s"'<>\)]+/g))
          urls.add(match[0]);
      }
    }
    // A moving default branch/PR set makes this scan incomplete; never delete from a mixed snapshot.
    const afterDefault = (
      await this.client.git.getRef({
        ...this.args(),
        ref: `heads/${this.defaultBranch}`,
      })
    ).data.object.sha;
    const afterPRs = await this.client.paginate(this.client.pulls.list, {
      ...this.args(),
      state: "open",
      per_page: 100,
    });
    const signature = (items: { number: number; sha: string }[]) =>
      JSON.stringify(items.slice().sort((a, b) => a.number - b.number));
    const open = prs.map((p) => ({ number: p.number, sha: p.head.sha }));
    const after = afterPRs.map((p) => ({ number: p.number, sha: p.head.sha }));
    return {
      complete:
        afterDefault === defaultSHA && signature(open) === signature(after),
      urls,
      default_branch_commit: defaultSHA,
      open_pr_heads: open,
    };
  }
  async materialize(
    p: PreparedCommit,
    beforeWrite: () => Promise<void>,
  ): Promise<void> {
    for (const blob of p.blobs) {
      await beforeWrite();
      const created = (
        await this.client.git.createBlob({
          ...this.args(),
          content: blob.content_base64,
          encoding: "base64",
        })
      ).data;
      if (created.sha !== blob.sha)
        throw new Error("GitHub blob hash mismatch");
    }
    await beforeWrite();
    const tree = (
      await this.client.git.createTree({
        ...this.args(),
        base_tree: p.base_tree,
        tree: p.blobs.map((b) => ({
          path: b.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: b.sha,
        })),
      })
    ).data;
    if (tree.sha !== p.tree_sha)
      throw new Error("GitHub deterministic tree mismatch");
    await beforeWrite();
    const commit = (
      await this.client.git.createCommit({
        ...this.args(),
        message: `${p.message}\n`,
        tree: p.tree_sha,
        parents: [p.base_commit],
        author: p.identity,
        committer: p.identity,
      })
    ).data;
    if (commit.sha !== p.commit_sha)
      throw new Error(
        "GitHub deterministic commit mismatch; stop before branch creation",
      );
  }
  async createBranch(branch: string, sha: string): Promise<void> {
    await this.client.git.createRef({
      ...this.args(),
      ref: `refs/heads/${branch}`,
      sha,
    });
  }
  async createPR(
    branch: string,
    title: string,
    body: string,
  ): Promise<PullRequestFact> {
    const p = (
      await this.client.pulls.create({
        ...this.args(),
        title,
        head: branch,
        base: this.defaultBranch,
        body,
        maintainer_can_modify: true,
      })
    ).data;
    return parsePullRequestFact({
      number: p.number,
      url: p.html_url,
      state: "open",
      branch,
      head_sha: p.head.sha,
      delivery_id: parseDeliveryMarker(body)?.delivery_id ?? null,
      created_at: p.created_at,
      closed_at: p.closed_at,
      merged_at: p.merged_at,
    });
  }
}

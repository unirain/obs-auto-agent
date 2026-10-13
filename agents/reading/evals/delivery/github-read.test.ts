import { expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import { OctokitGitHub, gitObjectSHA } from "../../src/publish/github.js";
import { sealed } from "./helpers.js";
function clientFixture(moving = false, modified = false) {
  const d = sealed();
  const base = "a".repeat(40),
    head = "b".repeat(40);
  const original = Buffer.from(d.files[0]!.content);
  const changed = Buffer.from("manual revision");
  const hashes = {
    original: gitObjectSHA("blob", original),
    changed: gitObjectSHA("blob", changed),
    diagram: gitObjectSHA(
      "blob",
      '<svg><image href="https://images.example/diagram.png"/></svg>',
    ),
  };
  let refs = 0;
  let reads = 0;
  const pr = {
    number: 1,
    head: { ref: "notes/p1/g1", sha: head },
    body: "<!-- reading-delivery:d1 project:p1 -->",
    merged: true,
    state: "closed",
    html_url: "https://github.com/test/repo/pull/1",
    created_at: "2026-10-01T00:00:00Z",
    closed_at: "2026-10-13T00:00:00Z",
    merged_at: "2026-10-13T00:00:00Z",
  };
  const client = {
    paginate: async (_fn: unknown, args: { state: string }) =>
      args.state === "open" ? [{ ...pr, merged: false, state: "open" }] : [pr],
    pulls: { list: () => {}, get: async () => ({ data: pr }) },
    git: {
      getRef: async (args: { ref: string }) => {
        if (args.ref.startsWith("heads/notes/"))
          return { data: { object: { sha: head } } };
        return {
          data: {
            object: { sha: moving && ++refs > 1 ? "c".repeat(40) : base },
          },
        };
      },
      getCommit: async (args: { commit_sha: string }) => ({
        data: { tree: { sha: args.commit_sha }, parents: [] },
      }),
      getTree: async (args: { tree_sha: string }) => ({
        data: {
          truncated: false,
          tree: [
            {
              path: d.files[0]!.path,
              mode: "100644",
              type: "blob",
              sha:
                args.tree_sha === head && modified
                  ? hashes.changed
                  : hashes.original,
            },
            {
              path: "图文件/graph.svg",
              mode: "100644",
              type: "blob",
              sha: hashes.diagram,
            },
          ],
        },
      }),
      getBlob: async (args: { file_sha: string }) => {
        reads++;
        return {
          data: {
            encoding: "base64",
            content: Buffer.from(
              args.file_sha === hashes.diagram
                ? '<svg><image href="https://images.example/diagram.png"/></svg>'
                : args.file_sha === hashes.changed
                  ? changed
                  : original,
            ).toString("base64"),
          },
        };
      },
    },
  } as unknown as Octokit;
  return { client, d, reads: () => reads };
}
it("remote reference scanner reads diagram sources and all pending heads, deduplicates blobs, and fails incomplete if refs move", async () => {
  const fixture = clientFixture();
  const refs = await new OctokitGitHub(
    fixture.client,
    "test/repo",
    "main",
  ).imageReferences();
  expect(refs.complete).toBe(true);
  expect(refs.urls.has("https://images.example/diagram.png")).toBe(true);
  expect(refs.open_pr_heads).toEqual([{ number: 1, sha: "b".repeat(40) }]);
  expect(fixture.reads()).toBe(2);
  const moving = clientFixture(true);
  expect(
    (
      await new OctokitGitHub(
        moving.client,
        "test/repo",
        "main",
      ).imageReferences()
    ).complete,
  ).toBe(false);
});
it.each([false, true])(
  "merged review outcome compares actual PR HEAD delivery bytes (modified=%s)",
  async (modified) => {
    const fixture = clientFixture(false, modified);
    const result = await new OctokitGitHub(
      fixture.client,
      "test/repo",
      "main",
    ).inspect(fixture.d);
    expect(result.review_outcome).toBe(
      modified ? "accepted_with_changes" : "accepted_without_changes",
    );
    expect(result.prs[0]?.created_at).toBe("2026-10-01T00:00:00Z");
    expect(result.merged_notes?.[0]?.content).toContain("# Mechanism");
  },
);

it("a foreign pending PR containing the article or target filename is a delivery conflict, even without local project ledger identity", async () => {
  const f = clientFixture();
  const original = f.client.paginate.bind(f.client);
  (f.client as unknown as { paginate: () => Promise<unknown[]> }).paginate =
    async () => [
      {
        number: 99,
        state: "open",
        head: { ref: "human/notes", sha: "b".repeat(40) },
        body: "Human note",
      },
    ];
  const result = await new OctokitGitHub(f.client, "test/repo", "main").inspect(
    f.d,
  );
  expect(result.prs).toEqual([]);
  expect(result.pending_duplicate).toBe(true);
});

it("only the trusted leading machine marker defines delivery identity; source quotations cannot inject another project marker", async () => {
  const { parseDeliveryMarker } = await import("../../src/publish/github.js");
  expect(
    parseDeliveryMarker(
      "<!-- reading-delivery:d1 project:p1 -->\n\nSource quoted <!-- reading-delivery:fake project:other -->",
    ),
  ).toEqual({ delivery_id: "d1", project_id: "p1" });
  expect(
    parseDeliveryMarker(
      "Source text\n<!-- reading-delivery:fake project:other -->",
    ),
  ).toBe(null);
});

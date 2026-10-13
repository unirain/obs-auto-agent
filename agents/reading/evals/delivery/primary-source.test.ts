import { expect, it } from "vitest";
import type { Octokit } from "@octokit/rest";
import {
  primarySourceURLs,
  samePrimarySource,
} from "../../src/publish/primary-source.js";
import { OctokitGitHub } from "../../src/publish/github.js";
import { sealed } from "./helpers.js";
const url = "https://example.com/post";
const d = () => sealed({ sources: [url, "https://example.com/paper"] });
it.each([
  `---\nsource: ${url}\n---\n本文`,
  `---\nsource_url: "https://EXAMPLE.COM/post?utm_source=mail#part"\n---\n本文`,
  `**原文链接**：[文章](${url})`,
  `Original source: <${url}>`,
  `Primary source: ${url}`,
  `*注：本笔记基于 <${url}> 编写。*`,
])(
  "matches only a declared primary source with exact normalized URL: %s",
  (note) => expect(samePrimarySource(note, d())).toBe(true),
);
it.each([
  `普通参考：[文章](${url})`,
  `---\nsource: https://example.com/other\n---\n相关文章：[文章](${url})`,
  `---\nsource: ${url}-2\n---\n`,
  `---\nsource_url: ${url}?id=2\n---\n`,
  `source: ${url}`,
  `    原文链接：${url}`,
  `\x60\x60\x60markdown\n\x60\x60\x60not-a-closing-fence\n原文链接：${url}\n\x60\x60\x60`,
  `\x60\x60\x60yaml\nsource: ${url}\n原文：${url}\n\x60\x60\x60`,
  `> 原文链接：${url}`,
  `<!-- 原文链接：${url} -->`,
  `原文链接：${url} 这里只是示例`,
  `---\nsource: https://example.com/paper\n---\n`,
])(
  "does not confuse references, code, similar paths, business queries or supplemental material with identity: %s",
  (note) => expect(samePrimarySource(note, d())).toBe(false),
);
it("only explicit trusted main aliases bridge redirects; query order is canonical while business values remain distinct", () => {
  const note = "---\nsource: http://legacy.example/old\n---\n";
  expect(samePrimarySource(note, d())).toBe(false);
  expect(
    samePrimarySource(note, {
      ...d(),
      primary_source_aliases: ["http://legacy.example/old"],
    }),
  ).toBe(true);
  expect(
    primarySourceURLs(
      "---\nsource: https://example.com/post?b=2&a=1&utm_campaign=test\n---\n",
    ),
  ).toEqual(new Set(["https://example.com/post?a=1&b=2"]));
  expect(
    samePrimarySource("---\nsource: https://example.com/post?a=1&b=2\n---\n", {
      sources: ["https://example.com/post?b=2&a=1"],
    }),
  ).toBe(true);
});
function sourceClient(note: string, pending: boolean): Octokit {
  const foreign = {
    number: 10,
    state: "open",
    head: { ref: "human/other-article", sha: "b".repeat(40) },
    body: "Human note",
  };
  return {
    paginate: async () => (pending ? [foreign] : []),
    pulls: { list: () => {} },
    git: {
      getRef: async (args: { ref: string }) => {
        if (args.ref.startsWith("heads/notes/")) throw { status: 404 };
        return { data: { object: { sha: "a".repeat(40) } } };
      },
      getCommit: async (args: { commit_sha: string }) => ({
        data: { tree: { sha: args.commit_sha } },
      }),
      getTree: async (args: { tree_sha: string }) => ({
        data: {
          truncated: false,
          tree:
            pending && args.tree_sha === "a".repeat(40)
              ? []
              : [
                  {
                    path: "Organize Notes By AI/foreign.md",
                    mode: "100644",
                    type: "blob",
                    sha: "c".repeat(40),
                  },
                ],
        },
      }),
      getBlob: async () => ({
        data: {
          encoding: "base64",
          content: Buffer.from(note).toString("base64"),
        },
      }),
    },
  } as unknown as Octokit;
}
it.each([false, true])(
  "real adapter source duplicate lookup uses metadata exactly in default/pending trees (pending=%s)",
  async (pending) => {
    const note =
      "---\nsource: https://example.com/other\n---\n参考：[post](https://example.com/post)";
    const falseFact = await new OctokitGitHub(
      sourceClient(note, pending),
      "test/repo",
      "main",
    ).inspect(d());
    expect(falseFact.default_branch_duplicate).toBe(false);
    expect(falseFact.pending_duplicate).toBe(false);
    const similarFact = await new OctokitGitHub(
      sourceClient("---\nsource: https://example.com/post-2\n---\n", pending),
      "test/repo",
      "main",
    ).inspect(d());
    expect(similarFact.default_branch_duplicate).toBe(false);
    expect(similarFact.pending_duplicate).toBe(false);
    const exactFact = await new OctokitGitHub(
      sourceClient(
        "---\nsource_url: https://example.com/post?utm_source=test\n---\n",
        pending,
      ),
      "test/repo",
      "main",
    ).inspect(d());
    expect(
      pending
        ? exactFact.pending_duplicate
        : exactFact.default_branch_duplicate,
    ).toBe(true);
  },
);

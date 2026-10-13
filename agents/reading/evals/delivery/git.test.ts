import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  gitObjectSHA,
  gitCommitContent,
  overlayTreeSHA,
} from "../../src/publish/github.js";
describe("deterministic Git objects", () => {
  it("matches native git hash-object for blobs and commit bytes (not a live GitHub verification)", () => {
    const bytes = Buffer.from("中文 note\n");
    expect(gitObjectSHA("blob", bytes)).toBe(
      execFileSync("git", ["hash-object", "--stdin"], {
        input: bytes,
        encoding: "utf8",
      }).trim(),
    );
    const commit = gitCommitContent(
      "a".repeat(40),
      "b".repeat(40),
      {
        name: "Reading Bot",
        email: "bot@example.com",
        date: "2026-10-13T00:00:00.000Z",
      },
      "Mechanism\n\nreading-delivery:d1",
    );
    expect(gitObjectSHA("commit", commit)).toBe(
      execFileSync("git", ["hash-object", "-t", "commit", "--stdin"], {
        input: commit,
        encoding: "utf8",
      }).trim(),
    );
  });
  it("builds the same tree from changed directory overlays and preserves unrelated existing files", () => {
    const a = gitObjectSHA("blob", "a"),
      b = gitObjectSHA("blob", "b"),
      c = gitObjectSHA("blob", "c");
    const base = [
      { path: "z.txt", mode: "100644", type: "blob", sha: a },
      { path: "d/x.txt", mode: "100644", type: "blob", sha: b },
    ];
    const expectedInner = gitObjectSHA(
      "tree",
      Buffer.concat([
        Buffer.from("100644 x.txt\0"),
        Buffer.from(b, "hex"),
        Buffer.from("100644 y.txt\0"),
        Buffer.from(c, "hex"),
      ]),
    );
    const expectedRoot = gitObjectSHA(
      "tree",
      Buffer.concat([
        Buffer.from("40000 d\0"),
        Buffer.from(expectedInner, "hex"),
        Buffer.from("100644 z.txt\0"),
        Buffer.from(a, "hex"),
      ]),
    );
    expect(overlayTreeSHA(base, [{ path: "d/y.txt", sha: c }])).toBe(
      expectedRoot,
    );
  });
});

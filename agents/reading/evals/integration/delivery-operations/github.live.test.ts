import { expect, it } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDeployment } from "../../../src/config/deployment.js";
import {
  parseAppCredentials,
  createGitHubAppClient,
} from "../../../src/publish/auth.js";
import { OctokitGitHub } from "../../../src/publish/github.js";
import { Publisher } from "../../../src/publish/publisher.js";
import {
  deliveryValidationHash,
  sha256,
} from "../../../src/publish/validate.js";
import type { SealedDelivery } from "../../../src/publish/types.js";
import {
  OssObjectStore,
  type OssStoreOptions,
} from "../../../src/storage/oss.js";
import { ImmutableWorkspaceManager } from "../../../src/workspace/manager.js";
import { WorkspaceJournal } from "../../../src/app/journal.js";
const enabled = process.env.READING_LIVE_DELIVERY === "1";
/** Real isolated API writes; requires explicit opt-in and an already verified trusted test profile. */
it.skipIf(!enabled)(
  "live isolated GitHub deterministic SHA and PR lost-response recovery backed by OSS checkpoints",
  async () => {
    const file = process.env.READING_LIVE_DEPLOYMENT;
    if (!file)
      throw new Error(
        "Set READING_LIVE_DEPLOYMENT to verified integration JSON",
      );
    const d = parseDeployment(JSON.parse(await readFile(file, "utf8")));
    if (
      d.name !== "integration" ||
      d.target_repository === "unirain/obs-notes-hub"
    )
      throw new Error("Live tests never use formal target");
    // Manager preflight validates actual service configuration; sample flags cannot bypass it.
    const encoded = process.env[d.workspace.credential_ref];
    if (!encoded) throw new Error("Missing isolated OSS credential reference");
    const credentials = JSON.parse(encoded) as Pick<
      OssStoreOptions,
      "accessKeyId" | "accessKeySecret" | "stsToken"
    >;
    const store = new OssObjectStore({
      ...credentials,
      bucket: d.workspace.bucket,
      region: d.workspace.region,
      endpoint: d.workspace.endpoint,
      allowed_prefix: d.workspace.prefix,
    });
    const root = await mkdtemp(join(tmpdir(), "reading-live-publisher-"));
    const manager = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      trusted_workspace_id: d.workspace_id,
      local_root: root,
      prefix: d.workspace.prefix.replace(/\/$/, ""),
    });
    let handle = await manager.restore(d.workspace_id, {
      allow_initialize: true,
      run_id: "live-github-spike",
    });
    const id = `live_${randomUUID().replace(/-/g, "")}`;
    const content = Buffer.from(
      `# Isolated publisher acceptance ${id}\n\nThis is a technical test fixture, not a quality-calibrated reading result.\n\nSource: https://example.com/${id}\n`,
    );
    const path = `Organize Notes By AI/${id}.md`;
    const committed = await manager.checkpoint(handle, {
      expected_revision: handle.revision,
      run_id: id,
      reason: "live_sealed_fixture",
      files: [
        {
          path: `outputs/${id}/${path}`,
          bytes: content,
          role: "output",
          project_id: id,
        },
      ],
    });
    if (committed.status !== "committed")
      throw new Error("Cannot seal live fixture");
    handle = committed.handle;
    const client = createGitHubAppClient(
      parseAppCredentials(process.env[d.github_app_credential_ref!]),
    );
    const accessible = await client.paginate(client.apps.listReposAccessibleToInstallation, { per_page: 100 });
    expect(accessible.map(r => r.full_name).sort()).toEqual([d.target_repository]);
    const appCredentials = parseAppCredentials(process.env[d.github_app_credential_ref!]);
    const installation = (await client.apps.getInstallation({ installation_id: appCredentials.installation_id })).data;
    expect(installation.permissions.contents).toBe('write');
    expect(installation.permissions.pull_requests).toBe('write');
    expect(installation.permissions.administration).not.toBe('write');
    expect(installation.permissions.workflows).not.toBe('write');
    const [owner, repo] = d.target_repository!.split("/");
    const target = (await client.repos.get({ owner: owner!, repo: repo! }))
      .data;
    const base = (
      await client.git.getRef({
        owner: owner!,
        repo: repo!,
        ref: `heads/${target.default_branch}`,
      })
    ).data.object.sha;
    const delivery: SealedDelivery = {
      schema_version: 1,
      delivery_id: id,
      execution_scope: "production",
      workspace_id: d.workspace_id,
      project_id: id,
      generation_version: 1,
      workspace_revision: handle.revision,
      context_id: "live-api-spike",
      base_commit: base,
      sources_verified_at: new Date().toISOString(),
      files: [
        {
          path,
          role: "note",
          mime: "text/markdown",
          bytes: content.length,
          sha256: sha256(content),
          content,
        },
      ],
      resources: [],
      sources: [`https://example.com/${id}`],
      quality_report: {
        passed: true,
        fixture: true,
        live_quality: "not_exercised",
      },
      rationale: "Isolated protocol validation",
      knowledge_increment: "Deterministic commit and lost-response evidence",
      gaps: [],
      image_degradations: [
        "Image publication not exercised by this GitHub spike",
      ],
      usage: { status: "unknown", estimated_usd: null },
      warnings: [
        "Technical fixture; user quality confirmation remains unverified",
      ],
      validated_hash: "",
    };
    delivery.validated_hash = deliveryValidationHash(delivery);
    const journal = new WorkspaceJournal(manager, handle, id);
    const github = new OctokitGitHub(
      client,
      d.target_repository!,
      target.default_branch,
    );
    const createPR = github.createPR.bind(github);
    let lose = true;
    github.createPR = async (...args) => {
      const result = await createPR(...args);
      if (lose) {
        lose = false;
        throw new Error("injected_PR_response_loss");
      }
      return result;
    };
    const options = {
      workspace_id: d.workspace_id,
      committedRevision: async () => journal.handle.revision,
      verifyCommittedDelivery: async () => {
        const f = journal.handle.snapshot.manifest.files.find(
          (f) => f.path === `outputs/${id}/${path}`,
        );
        if (f?.sha256 !== sha256(content))
          throw new Error("Uncommitted live delivery");
      },
      classificationCurrent: async () => true,
      identity: {
        name: "Reading Acceptance Bot",
        email: "reading-acceptance@example.invalid",
      },
    };
    try {
      await expect(
        new Publisher(github, journal, async () => {}, options).publish(
          delivery,
        ),
      ).rejects.toThrow("injected_PR_response_loss");
      const restored = await manager.restore(d.workspace_id);
      const recoveredJournal = new WorkspaceJournal(
        manager,
        restored,
        id + "-resume",
      );
      const result = await new Publisher(
        github,
        recoveredJournal,
        async () => {},
        {
          ...options,
          committedRevision: async () => recoveredJournal.handle.revision,
        },
      ).publish(delivery);
      expect(result.status).toBe("awaiting_review");
      expect(result.pr?.number).toBeGreaterThan(0);
      const facts = await github.inspect(delivery, result.prepared!);
      expect(facts.prs).toHaveLength(1);
      expect(facts.complete_diff_matches).toBe(true);
      expect(facts.branch_sha).toBe(result.prepared!.commit_sha);
      // Only isolated test PR is closed; no merging, force push or workspace commit deletion.
      await client.pulls.update({
        owner: owner!,
        repo: repo!,
        pull_number: result.pr!.number,
        state: "closed",
      });
      const closed = await new Publisher(
        github,
        recoveredJournal,
        async () => {},
        options,
      ).publish(delivery);
      expect(closed.status).toBe("closed_unmerged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);

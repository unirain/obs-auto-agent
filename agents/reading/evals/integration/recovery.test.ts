import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import {
  WorkspaceJournal,
  ApplicationInvocationJournal,
} from "../../src/app/journal.js";
import { applyRecovery } from "../../src/app/recovery.js";
import { newRuntimeProject } from "../../src/stages/driver.js";
import { discoverCandidate } from "../../src/collect/identity.js";
import { buildContext } from "../../src/context/index.js";
import type { HostProject } from "../../src/app/controller.js";
import { PolicyGate } from "../../src/policy/gate.js";
import { policyFixture } from "../runtime/policy-fixtures.js";
import {
  StageExecutor,
  stageInputHash,
  type StageExecution,
} from "../../src/stages/executor.js";
import { RunDeadline } from "../../src/runtime/deadline.js";
import type { InvocationRecord } from "../../src/contracts/index.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "recovery-eval-"));
  const store = new FileObjectStore(join(root, "objects"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope: "preview",
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  const journal = new WorkspaceJournal(
    manager,
    await manager.restore("obs-notes-hub/reading-preview/recovery", {
      allow_initialize: true,
    }),
    "run1",
  );
  const context = buildContext({
    index: [],
    query: "test",
    heldout: { urls: new Set(), note_paths: new Set() },
    preferences_hash: "p",
    skill_commit: "a".repeat(40),
    skill_hash: "s",
    prompt_hash: "p",
    model: "replay",
    evidence_versions: [],
  });
  const candidate = discoverCandidate(
    "manual_url",
    "https://example.org/article",
    "Article",
    null,
    new Date().toISOString(),
  );
  const project: HostProject = {
    ...newRuntimeProject(candidate, {
      project_id: "p1",
      execution_scope: "preview",
      workspace_id: journal.handle.workspace_id,
      context,
      now: new Date(),
    }),
    generation_version: 1,
    resume_stage: "research",
    resume_policy: "manual",
    reason: "request_unknown",
    last_run_id: "run1",
    batch_id: "b1",
    delivery_id: null,
    sources_verified_at: null,
    state: "deferred",
  };
  project.counters.revisions = 2;
  project.counters.stalled_batches = 2;
  const gate = new PolicyGate(
    async () => ({ ...policyFixture(), hash: "a".repeat(64) }),
    async () => {},
  );
  const input: StageExecution = {
    task: {
      project_id: "p1",
      stage: "research",
      execution_scope: "preview",
      workspace_id: project.workspace_id,
      context_id: context.context_id,
      input_hash: "",
      checkpoint: "research",
      capability: "research",
      deadline: Date.now() + 60000,
      state: "researching",
    },
    subject: {
      subject_ref: "project:p1",
      project_id: "p1",
      execution_scope: "preview",
      candidate_id: candidate.candidate_id,
      origin_source_ids: ["manual_url"],
      urls: [candidate.url],
      main_url: candidate.url,
      source_snapshot_hash: "body",
      classification: {
        candidate_id: candidate.candidate_id,
        source_snapshot_hash: "body",
        semantic_policy_hash: policyFixture().semantic_policy_hash,
        content_eligibility: "allowed",
        evidence_hash: "e",
      },
    },
    prompt: "fixed",
    system_prompt: "system",
    schema: {},
    cwd: root,
    model: "replay",
    tools: [],
    deadline: new RunDeadline(),
  };
  input.task.input_hash = stageInputHash(input);
  project.pending_query = {
    stage: "research",
    capability: "research",
    prompt: "fixed",
    input_hash: input.task.input_hash,
    semantic_policy_hash: policyFixture().semantic_policy_hash,
  };
  await journal.commit("projects/p1", project);
  const calls = new ApplicationInvocationJournal(journal);
  const original: InvocationRecord = {
    schema_version: 1,
    invocation_id: "old",
    execution_scope: "preview",
    subject_id: "project:p1",
    capability: "research",
    input_hash: input.task.input_hash,
    context_hash: context.context_id,
    policy_hash: "a".repeat(64),
    model: "replay",
    sdk_version: "test",
    status: "prepared",
    messages: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cost_status: "unknown",
      cost_usd: null,
    },
    limits: {},
  };
  await calls.prepare(original);
  await calls.finish("old", "unknown");
  const request = (
    action: string,
    recovery_id: string,
    extras: Record<string, unknown> = {},
  ) => ({
    schema_version: 1,
    recovery_id,
    project_id: "p1",
    expected_revision: journal.handle.revision,
    reason: "Operator inspected request and provider receipt",
    evidence_reference: "private-audit:ticket-123",
    action,
    ...extras,
  });
  return {
    root,
    store,
    manager,
    journal,
    calls,
    project,
    gate,
    input,
    request,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
it("unknown stays blocked without evidence; explicit retry survives restore, preserves counters/unknown cost and permits only one successful replacement", async () => {
  const f = await fixture();
  try {
    await expect(
      applyRecovery(f.journal, f.request("unblock", "blocked"), "operator"),
    ).rejects.toThrow("invocation_unresolved");
    await expect(
      applyRecovery(
        f.journal,
        f.request("confirm_not_started", "not-started", {
          invocation_id: "old",
          input_hash: f.input.task.input_hash,
        }),
        "operator",
      ),
    ).rejects.toThrow("not_started_unproven");
    const authorization = f.request("authorize_retry", "allow", {
      invocation_id: "old",
      input_hash: f.input.task.input_hash,
      acknowledge_possible_duplicate_charge: true,
    });
    await applyRecovery(f.journal, authorization, "operator");
    await expect(
      applyRecovery(
        f.journal,
        { ...authorization, recovery_id: "stale" },
        "operator",
      ),
    ).rejects.toThrow("revision_changed");
    await applyRecovery(f.journal, f.request("unblock", "unblock"), "operator");
    const restored = new WorkspaceJournal(
      f.manager,
      await f.manager.restore(f.project.workspace_id),
      "run2",
    );
    expect(
      await applyRecovery(restored, authorization, "operator"),
    ).toMatchObject({ status: "already_applied" });
    expect((await restored.load<HostProject>("projects/p1"))!.counters).toEqual(
      f.project.counters,
    );
    const replay = new ApplicationInvocationJournal(restored);
    let queries = 0;
    const executor = new StageExecutor(
      {
        async *stream() {
          queries++;
          yield {
            message_id: "reply",
            type: "result",
            summary: true,
            success: true,
            result: { answer: "confirmed" },
            usage: {
              input_tokens: 3,
              output_tokens: 2,
              cost_status: "unknown",
              cost_usd: null,
            },
            observable: {},
          };
        },
      },
      f.gate,
      replay,
    );
    await executor.execute(f.input);
    await executor.execute(f.input);
    expect(queries).toBe(1);
    expect(
      await replay.find("project:p1", "different-stage-input", "write"),
    ).toBeNull();
    expect(await restored.load("invocations/old")).toMatchObject({
      status: "unknown",
      usage: { cost_status: "unknown", cost_usd: null },
    });
  } finally {
    await f.cleanup();
  }
});
it("a replacement with unknown result creates a new barrier rather than inheriting old authorization", async () => {
  const f = await fixture();
  try {
    await applyRecovery(
      f.journal,
      f.request("authorize_retry", "allow", {
        invocation_id: "old",
        input_hash: f.input.task.input_hash,
        acknowledge_possible_duplicate_charge: true,
      }),
      "operator",
    );
    const executor = new StageExecutor(
      {
        async *stream() {
          throw new Error("transport_lost");
        },
      },
      f.gate,
      f.calls,
    );
    await expect(executor.execute(f.input)).rejects.toThrow("transport_lost");
    const next = await f.calls.find(
      "project:p1",
      f.input.task.input_hash,
      "research",
    );
    expect(next?.status).toBe("unknown");
    expect(next?.invocation_id).not.toBe("old");
    await expect(executor.execute(f.input)).rejects.toThrow("request_unknown");
  } finally {
    await f.cleanup();
  }
});
it("a confirmed result is bound to the original request and imported atomically, never relabelled as free", async () => {
  const f = await fixture();
  try {
    const receipt = f.request("record_result", "receipt", {
      invocation_id: "old",
      input_hash: f.input.task.input_hash,
      status: "succeeded",
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cost_status: "unknown",
        cost_usd: null,
      },
      structured_response: { answer: "provider receipt" },
    });
    await expect(
      applyRecovery(f.journal, { ...receipt, input_hash: "wrong" }, "operator"),
    ).rejects.toThrow("binding_mismatch");
    await applyRecovery(f.journal, receipt, "operator");
    await applyRecovery(f.journal, f.request("unblock", "unblock"), "operator");
    const restored = new WorkspaceJournal(
      f.manager,
      await f.manager.restore(f.project.workspace_id),
      "run2",
    );
    const executor = new StageExecutor(
      {
        async *stream() {
          throw new Error("must_not_query");
        },
      },
      f.gate,
      new ApplicationInvocationJournal(restored),
    );
    expect(await executor.execute(f.input)).toMatchObject({
      result: { answer: "provider receipt" },
    });
    expect(await restored.load("invocation-history/old/receipt")).toMatchObject(
      { status: "unknown" },
    );
  } finally {
    await f.cleanup();
  }
});
it("a failed recovery checkpoint cannot authorize any SDK request, and remote uncertainty refuses unblock", async () => {
  const f = await fixture();
  try {
    await f.journal.commit("delivery-test", {
      project_id: "p1",
      status: "publishing",
      uncertain_action: "create_pr",
    });
    await expect(
      applyRecovery(
        f.journal,
        f.request("authorize_retry", "remote", {
          invocation_id: "old",
          input_hash: f.input.task.input_hash,
          acknowledge_possible_duplicate_charge: true,
        }),
        "operator",
      ),
    ).rejects.toThrow("delivery_reconciliation");
    await f.journal.commitMany(
      { "delivery-test": null },
      "invocation_reconciled",
    );
    f.store.faults.push({ operation: "create", kind: "permission" });
    await expect(
      applyRecovery(
        f.journal,
        f.request("authorize_retry", "lost", {
          invocation_id: "old",
          input_hash: f.input.task.input_hash,
          acknowledge_possible_duplicate_charge: true,
        }),
        "operator",
      ),
    ).rejects.toThrow();
    const restored = new WorkspaceJournal(
      f.manager,
      await f.manager.restore(f.project.workspace_id),
      "run2",
    );
    expect(await restored.load("invocation-resolutions/old")).toBeUndefined();
    expect(
      (
        await new ApplicationInvocationJournal(restored).find(
          "project:p1",
          f.input.task.input_hash,
          "research",
        )
      )?.status,
    ).toBe("unknown");
  } finally {
    await f.cleanup();
  }
});

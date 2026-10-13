import { it, expect } from "vitest";
import {EventEmitter} from 'node:events';
import {processCancellation} from '../../src/app/signals.js';
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

async function fixture(scope: 'preview'|'production' = 'preview') {
  const root = await mkdtemp(join(tmpdir(), "recovery-eval-"));
  const store = new FileObjectStore(join(root, "objects"));
  const manager = new ImmutableWorkspaceManager({
    store,
    scope,
    local_root: join(root, "local"),
    verify_preflight: false,
  });
  const journal = new WorkspaceJournal(
    manager,
    await manager.restore(scope==='preview'?"obs-notes-hub/reading-preview/recovery":"obs-notes-hub/reading", {
      allow_initialize: true,
    }),
    "run1",
  );
  const context = buildContext({
    index: [],
    query: "test",
    heldout: { urls: new Set(), note_paths: new Set() },
    preferences_hash: "148de9c5a7a44d19e56cd9ae1a554bf67847afb0c58f6e12fa29ac7ddfca9940",
    skill_commit: "a".repeat(40),
    skill_hash: "043a718774c572bd8a25adbeb1bfcd5c0256ae11cecf9f9c3f925d0e52beaf89",
    prompt_hash: "148de9c5a7a44d19e56cd9ae1a554bf67847afb0c58f6e12fa29ac7ddfca9940",
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
      execution_scope: scope,
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
      execution_scope: scope,
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
      execution_scope: scope,
      candidate_id: candidate.candidate_id,
      origin_source_ids: ["manual_url"],
      urls: [candidate.url],
      main_url: candidate.url,
      source_snapshot_hash: "230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5",
      classification: {
        candidate_id: candidate.candidate_id,
        source_snapshot_hash: "230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5",
        semantic_policy_hash: policyFixture().semantic_policy_hash,
        content_eligibility: "allowed",
        evidence_hash: "3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea",
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
  input.task.deadline=input.deadline.generation_deadline;
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
    execution_scope: scope,
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

it('explicit changed input creates one new generation, preserving prior fees and classification allowance while archiving exhausted counters',async()=>{
 const f=await fixture();try{
  await expect(applyRecovery(f.journal,f.request('new_generation','unsafe',{guidance:'Explain the failure mechanism more deeply'}),'operator')).rejects.toThrow('generation_invocation_unresolved');
  await applyRecovery(f.journal,f.request('record_result','received',{invocation_id:'old',input_hash:f.input.task.input_hash,status:'succeeded',usage:{input_tokens:7,output_tokens:4,cost_status:'unknown',cost_usd:null},structured_response:{answer:'actual receipt'}}),'operator');
  const old=(await f.journal.load<HostProject>('projects/p1'))!;old.classification={candidate_id:old.candidate.candidate_id,source_snapshot_hash:'230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5',semantic_policy_hash:'e8bc163c82eee18733288c7d4ac636db3a6deb013ef2d37b68322be20edc45cc',attempts:2,format_repairs:1,pending:false,credential:null};await f.journal.commit('projects/p1',old);
  const request=f.request('new_generation','new-input',{guidance:'Explain the failure mechanism more deeply'});expect(await applyRecovery(f.journal,request,'operator')).toMatchObject({generation_version:2});
  const restored=new WorkspaceJournal(f.manager,await f.manager.restore(f.project.workspace_id),'run2');const next=(await restored.load<HostProject>('projects/p1'))!;
  expect(next.generation_version).toBe(2);expect(next.counters.revisions).toBe(0);expect(next.counters.stalled_batches).toBe(0);expect(next.classification?.attempts).toBe(2);expect(next.context.example_texts).toEqual(old.context.example_texts);expect(next.context.context_id).not.toBe(old.context.context_id);
  expect(await restored.load('generation-archives/p1/g1')).toMatchObject({project:{counters:{revisions:2,stalled_batches:2}}});expect(await restored.load('invocations/old')).toMatchObject({status:'succeeded',usage:{input_tokens:7,cost_status:'unknown'}});
  expect(await applyRecovery(restored,request,'operator')).toMatchObject({status:'already_applied'});
  await expect(applyRecovery(restored,{...request,recovery_id:'duplicate-input',expected_revision:restored.handle.revision},'operator')).rejects.toThrow('generation_input_unchanged');
  next.state='preview_ready';await restored.commit('projects/p1',next);
  await applyRecovery(restored,{...request,recovery_id:'second-guidance',guidance:'Add the observed operating limits',expected_revision:restored.handle.revision},'operator');
  expect(await restored.load('projects/p1')).toMatchObject({generation_version:3,state:'discovered',classification:{attempts:2}});
 }finally{await f.cleanup();}
});

it('terminal PR feedback remains a separate atomic fact and cannot regenerate the project',async()=>{
 const f=await fixture();try{
  await applyRecovery(f.journal,f.request('record_result','received',{invocation_id:'old',input_hash:f.input.task.input_hash,status:'succeeded',usage:{input_tokens:7,output_tokens:4,cost_status:'unknown',cost_usd:null},structured_response:{answer:'actual receipt'}}),'operator');
  const old=(await f.journal.load<HostProject>('projects/p1'))!;old.state='pr_open';await f.journal.commit('projects/p1',old);
  await expect(applyRecovery(f.journal,f.request('new_generation','new-input',{guidance:'More explanation'}),'operator')).rejects.toThrow('terminal_project');
  await applyRecovery(f.journal,f.request('record_feedback','feedback',{delivery_id:'d1',feedback_reason:'too_shallow',review_minutes:9}),'operator',{prepare_feedback:async(request,actor,project)=>({'review-feedback/d1':{schema_version:1,actor,project_id:project.project_id,reason:request.feedback_reason,review_minutes:request.review_minutes,origin:'trusted_management'}})});
  const restored=await f.manager.restore(f.project.workspace_id);expect(restored.records['review-feedback/d1']).toMatchObject({reason:'too_shallow',review_minutes:9});expect(restored.records['projects/p1']).toMatchObject({state:'pr_open',counters:{revisions:2,stalled_batches:2}});expect(restored.records['recoveries/feedback']).toBeDefined();
 }finally{await f.cleanup();}
});

it('production regeneration requires complete remote readiness and persists its proof with the new input',async()=>{
 const f=await fixture('production');try{
  await applyRecovery(f.journal,f.request('record_result','received',{invocation_id:'old',input_hash:f.input.task.input_hash,status:'succeeded',usage:{input_tokens:7,output_tokens:4,cost_status:'unknown',cost_usd:null},structured_response:{answer:'actual receipt'}}),'operator');
  const request=f.request('new_generation','new-input',{guidance:'Explain the failure mechanism'});
  await expect(applyRecovery(f.journal,request,'operator')).rejects.toThrow('remote_readiness_unavailable');
  await expect(applyRecovery(f.journal,request,'operator',{readiness:async()=>({complete:false,allowed:true,evidence:{}})})).rejects.toThrow('remote_readiness_denied');
  await expect(applyRecovery(f.journal,request,'operator',{readiness:async()=>({complete:true,allowed:false,evidence:{}})})).rejects.toThrow('remote_readiness_denied');
  expect(await f.journal.load('recoveries/new-input')).toBeUndefined();
  const proof={kind:'readonly_remote_observations',default_head:'a'.repeat(40)};
  await applyRecovery(f.journal,request,'operator',{readiness:async()=>({complete:true,allowed:true,evidence:proof})});
  const restored=await f.manager.restore(f.project.workspace_id);
  expect(restored.records['generation-archives/p1/g1']).toMatchObject({readiness:proof});expect(restored.records['projects/p1']).toMatchObject({generation_version:2,execution_scope:'production'});
 }finally{await f.cleanup();}
});

it('SIGTERM interrupts an active paid query and a cold restart preserves unknown fees without repeating it',async()=>{
 const f=await fixture(),signals=new EventEmitter(),cancel=processCancellation(signals);try{
  await applyRecovery(f.journal,f.request('record_result','before-cancel',{invocation_id:'old',input_hash:f.input.task.input_hash,status:'succeeded',usage:{input_tokens:7,output_tokens:4,cost_status:'unknown',cost_usd:null},structured_response:{answer:'previous receipt'}}),'operator');
  const input={...f.input,prompt:'new fixed query',deadline:new RunDeadline(Date.now(),60000,5000,cancel.signal)};input.task={...input.task,input_hash:'',deadline:input.deadline.generation_deadline};input.task.input_hash=stageInputHash(input);let calls=0;
  const adapter={async *stream(request:import('../../src/runtime/sdk.js').QueryRequest){calls++;expect(request.vault_root).toBe(join(f.root,'projects','p1','draft'));yield {message_id:'partial-before-cancel',type:'assistant' as const,summary:false,usage:{input_tokens:11,output_tokens:3,cost_status:'unknown' as const,cost_usd:null},observable:{}};signals.emit('SIGTERM');expect(request.signal.aborted).toBe(true);throw new Error('sdk_cancelled');}};
  await expect(new StageExecutor(adapter,f.gate,f.calls).execute(input)).rejects.toThrow('request_unknown:run_cancelled');expect(input.deadline.mayStart()).toBe(false);
  const restored=new WorkspaceJournal(f.manager,await f.manager.restore(f.project.workspace_id),'run2');const record=await new ApplicationInvocationJournal(restored).find('project:p1',input.task.input_hash,'research');expect(record).toMatchObject({status:'unknown',usage:{input_tokens:11,cost_status:'unknown',cost_usd:null}});
  await expect(new StageExecutor(adapter,f.gate,new ApplicationInvocationJournal(restored)).execute(inputForFreshDeadline(input))).rejects.toThrow('request_unknown');expect(calls).toBe(1);
 }finally{cancel.close();expect(signals.listenerCount('SIGTERM')).toBe(0);expect(signals.listenerCount('SIGINT')).toBe(0);await f.cleanup();}
});

function inputForFreshDeadline(input:StageExecution):StageExecution{const deadline=new RunDeadline();return {...input,deadline,task:{...input.task,deadline:deadline.generation_deadline}};}

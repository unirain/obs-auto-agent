import { Type, type Static } from "@sinclair/typebox";
import { canonicalJson, type InvocationRecord } from "../contracts/index.js";
import { parseModel } from "../stages/contracts.js";
import type { HostProject } from "./controller.js";
import type { WorkspaceJournal } from "./journal.js";
import {prepareNewGeneration,type NewGenerationPorts} from './generation.js';

const identity = Type.String({
  pattern: "^[A-Za-z0-9_-]+$",
  minLength: 1,
  maxLength: 200,
});
const usage = Type.Object(
  {
    input_tokens: Type.Integer({ minimum: 0 }),
    output_tokens: Type.Integer({ minimum: 0 }),
    cost_status: Type.Union([Type.Literal("known"), Type.Literal("unknown")]),
    cost_usd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
const common = {
  schema_version: Type.Literal(1),
  recovery_id: identity,
  project_id: identity,
  expected_revision: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  evidence_reference: Type.String({ minLength: 1, maxLength: 2000 }),
};
export const RecoveryRequestSchema = Type.Union([
  Type.Object({...common,action:Type.Literal('new_generation'),guidance:Type.String({minLength:1,maxLength:8000}),approved_skill_commit:Type.Optional(Type.String({pattern:'^[a-f0-9]{40}$'})),refresh_runtime:Type.Optional(Type.Boolean())},{additionalProperties:false}),
  Type.Object({...common,action:Type.Literal('record_feedback'),delivery_id:identity,feedback_reason:Type.Optional(Type.Union((['topic_irrelevant','duplicate','too_shallow','incorrect_fact','missing_source','image_or_text_quality','more_like_this'] as const).map(value=>Type.Literal(value)))),review_minutes:Type.Optional(Type.Union([Type.Number({minimum:0}),Type.Null()]))},{additionalProperties:false}),
  Type.Object(
    { ...common, action: Type.Literal("unblock") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...common,
      action: Type.Literal("authorize_retry"),
      invocation_id: identity,
      input_hash: Type.String({ minLength: 1 }),
      acknowledge_possible_duplicate_charge: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...common,
      action: Type.Literal("confirm_not_started"),
      invocation_id: identity,
      input_hash: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...common,
      action: Type.Literal("record_result"),
      invocation_id: identity,
      input_hash: Type.String({ minLength: 1 }),
      status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
      usage,
      structured_response: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: false },
  ),
]);
export type RecoveryRequest = Static<typeof RecoveryRequestSchema>;
export type InvocationResolution = {
  action: RecoveryRequest["action"];
  invocation_id?: string;
  input_hash?: string;
  capability?: string;
  subject_id?: string;
  replacement_invocation_id?: string;
  execution_scope: string;
  workspace_id: string;
  generation_version: number;
  recovery_id: string;
  actor: string;
};
/** Human commands are never model tools. Unknown financial facts are retained even when an operator authorizes a retry. */
export async function applyRecovery(
  journal: WorkspaceJournal,
  value: unknown,
  actor: string,
  ports:NewGenerationPorts&{prepare_feedback?:(request:Extract<RecoveryRequest,{action:'record_feedback'}>,actor:string,project:HostProject)=>Promise<Record<string,unknown>>}={},
) {
  const request = parseModel<RecoveryRequest>(RecoveryRequestSchema, value);
  if (
    !actor.trim() ||
    !request.reason.trim() ||
    !request.evidence_reference.trim()
  )
    throw new Error("recovery_audit_required");
  const auditKey = "recoveries/" + request.recovery_id;
  const prior = await journal.load<{ request: RecoveryRequest; actor: string }>(
    auditKey,
  );
  if (prior) {
    if (
      canonicalJson(prior.request) !== canonicalJson(request) ||
      prior.actor !== actor
    )
      throw new Error("recovery_id_conflict");
    return {
      recovery_id: request.recovery_id,
      status: "already_applied",
      revision: journal.handle.revision,
    };
  }
  if (journal.handle.revision !== request.expected_revision)
    throw new Error("recovery_revision_changed");
  const project = await journal.load<HostProject>(
    "projects/" + request.project_id,
  );
  if (
    !project ||
    project.workspace_id !== journal.handle.workspace_id ||
    project.execution_scope !== journal.handle.execution_scope
  )
    throw new Error("recovery_project_scope_mismatch");
  if (request.action!=='record_feedback'&&request.action!=='record_result'&&
    !(request.action==='new_generation'&&project.execution_scope==='preview'&&['preview_ready','skipped'].includes(project.state))&&
    [
      "publishing",
      "pr_open",
      "merged",
      "closed_unmerged",
      "skipped",
      "preview_ready",
    ].includes(project.state)
  )
    throw new Error("recovery_remote_or_terminal_project");
  for (const key of request.action==='record_feedback'||request.action==='record_result'||request.action==='new_generation'?[]:journal.keys("delivery-")) {
    const delivery = await journal.load<{
      project_id?: string;
      uncertain_action?: string | null;
      status?: string;
      pr?: unknown;
    }>(key);
    if (
      delivery?.project_id === project.project_id &&
      (delivery.uncertain_action ||
        delivery.status === "publishing" ||
        delivery.pr)
    )
      throw new Error("recovery_delivery_reconciliation_required");
  }
  const records: Record<string, unknown> = {
    [auditKey]: {
      request,
      actor,
      workspace_id: project.workspace_id,
      execution_scope: project.execution_scope,
      generation_version: project.generation_version,
      recorded_at: new Date().toISOString(),
    },
  };
  if(request.action==='new_generation'){
    const prepared=await prepareNewGeneration(journal,project,request,actor,request.recovery_id,request.evidence_reference,ports);
    await journal.commitMany({...records,...prepared.updates},'operator_changed_input',[prepared.context_file],prepared.remove_paths);
    return {recovery_id:request.recovery_id,status:'applied',revision:journal.handle.revision,generation_version:prepared.next.generation_version};
  }else if(request.action==='record_feedback'){
    if(!ports.prepare_feedback)throw new Error('recovery_feedback_port_unavailable');
    Object.assign(records,await ports.prepare_feedback(request,actor,project));
  }else if (request.action === "unblock") {
    if (project.state !== "deferred" || project.resume_policy !== "manual")
      throw new Error("recovery_not_manual_project");
    for (const key of journal.keys("invocations/")) {
      const call = (await journal.load<InvocationRecord>(key))!;
      if (call.subject_id !== "project:" + project.project_id) continue;
      const authorized = await retryAuthorized(
        journal,
        call,
        project.pending_query?.input_hash ?? "",
        project.pending_query?.capability ?? "",
      );
      if (
        (["prepared", "running", "unknown"].includes(call.status) ||
          (call.status === "failed" && call.request_started !== false)) &&
        !authorized
      )
        throw new Error("recovery_invocation_unresolved");
    }
    // Counters, input, context, pending query and prior external facts are unchanged.
    records["projects/" + project.project_id] = {
      ...project,
      resume_policy: "automatic",
      reason: "manually_unblocked:" + request.recovery_id,
    };
  } else {
    const call = await journal.load<InvocationRecord>(
      "invocations/" + request.invocation_id,
    );
    if (
      !call ||
      call.subject_id !== "project:" + project.project_id ||
      call.execution_scope !== project.execution_scope ||
      call.input_hash !== request.input_hash
    )
      throw new Error("recovery_invocation_binding_mismatch");
    if (call.status === "succeeded")
      throw new Error("recovery_terminal_success");
    const resolution = {
      action: request.action,
      invocation_id: call.invocation_id,
      input_hash: call.input_hash,
      capability: call.capability,
      subject_id: call.subject_id,
      execution_scope: project.execution_scope,
      workspace_id: project.workspace_id,
      generation_version: project.generation_version,
      recovery_id: request.recovery_id,
      actor,
    };
    const oldResolution = await journal.load<InvocationResolution>(
      "invocation-resolutions/" + call.invocation_id,
    );
    if (oldResolution) {
      if (!((oldResolution.action==='record_result'&&request.action==='authorize_retry'&&call.status==='failed')||(oldResolution.action==='authorize_retry'&&request.action==='record_result')))
        throw new Error("recovery_invocation_already_resolved");
      records[
        "resolution-history/" +
          call.invocation_id +
          "/" +
          oldResolution.recovery_id
      ] = oldResolution;
    }
    if (request.action === "authorize_retry") {
      if (
        !project.pending_query ||
        project.pending_query.input_hash !== call.input_hash ||
        project.pending_query.capability !== call.capability
      )
        throw new Error("recovery_retry_requires_fixed_pending_input");
      if (call.capability === "classify_only") {
        if (!project.classification || project.classification.attempts >= (project.context.runtime_limits?.classification_queries??2))
          throw new Error("recovery_classification_limit");
        records["projects/" + project.project_id] = {
          ...project,
          classification: {
            ...project.classification,
            attempts: project.classification.attempts + 1,
          },
        };
      }
      // This is explicit human authorization, not a claim that the old request was free or absent.
    } else if (request.action === "confirm_not_started") {
      if (
        call.request_started !== false ||
        call.usage.input_tokens !== 0 ||
        call.usage.output_tokens !== 0 ||
        call.usage.cost_status !== "known" ||
        call.usage.cost_usd !== 0
      )
        throw new Error("recovery_not_started_unproven");
      records["invocations/" + call.invocation_id] = {
        ...call,
        status: "failed",
      };
    } else {
      if (
        request.status === "succeeded" &&
        !Object.hasOwn(request, "structured_response")
      )
        throw new Error("recovery_result_missing");
      if (
        (request.usage.cost_status === "known") !==
        (request.usage.cost_usd !== null)
      )
        throw new Error("recovery_usage_inconsistent");
      records[
        "invocation-history/" + call.invocation_id + "/" + request.recovery_id
      ] = call;
      records["invocations/" + call.invocation_id] = {
        ...call,
        status: request.status,
        request_started: true,
        messages: [
          ...call.messages,
          {
            message_id: "manual_result_" + request.recovery_id,
            summary: true,
            usage: request.usage,
          },
        ],
        usage: request.usage,
      };
      if (request.status === "succeeded")
        records["responses/" + call.invocation_id] =
          request.structured_response;
      if(call.context_hash!==project.context.context_id)records['binding-superseded/'+call.invocation_id]={subject_id:call.subject_id,input_hash:call.input_hash,reason:'late_receipt_previous_generation'};
    }
    records["invocation-resolutions/" + call.invocation_id] = resolution;
  }
  await journal.commitMany(records, "invocation_reconciled");
  return {
    recovery_id: request.recovery_id,
    status: "applied",
    revision: journal.handle.revision,
  };
}

export async function retryAuthorized(
  journal: WorkspaceJournal,
  call: InvocationRecord,
  input_hash: string,
  capability: string,
): Promise<boolean> {
  const resolution = await journal.load<InvocationResolution>(
    "invocation-resolutions/" + call.invocation_id,
  );
  if (
    !resolution ||
    resolution.action !== "authorize_retry" ||
    resolution.subject_id !== call.subject_id ||
    resolution.execution_scope !== journal.handle.execution_scope ||
    resolution.workspace_id !== journal.handle.workspace_id
  )
    return false;
  const project = await journal.load<HostProject>(
    "projects/" + call.subject_id.replace(/^project:/, ""),
  );
  if (
    resolution.input_hash === input_hash &&
    resolution.capability === capability
  )
    return project?.generation_version === resolution.generation_version;
  const replacement = resolution.replacement_invocation_id
    ? await journal.load<InvocationRecord>(
        "invocations/" + resolution.replacement_invocation_id,
      )
    : undefined;
  return (
    replacement?.status === "succeeded" &&
    replacement.subject_id === call.subject_id &&
    replacement.input_hash === call.input_hash &&
    replacement.capability === call.capability
  );
}

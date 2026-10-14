import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {canonicalJson,type InvocationRecord,type InvocationMessage} from '../contracts/index.js';
import {digest,parseStageTask,type StageTask} from './contracts.js';
import {PolicyGate,type PolicySubject} from '../policy/gate.js';
import {type ModelAdapter,type ToolDefinition,SDK_VERSION,QueryNotStartedError} from '../runtime/sdk.js';
import {resolveRuntimeLimits,type ResolvedRuntimeLimits} from '../runtime/limits.js';
import {RunDeadline} from '../runtime/deadline.js';
export interface JournalPort {find(subject_id:string,input_hash:string,capability:string):Promise<InvocationRecord|null>;result?(id:string):Promise<unknown>;prepare(record:InvocationRecord):Promise<void>;
  observe(id:string,message:InvocationMessage,observable:Record<string,unknown>):Promise<void>;finish(id:string,status:'succeeded'|'failed'|'unknown'):Promise<void>}
export type StageExecution={task:StageTask;subject:PolicySubject;prompt:string;system_prompt:string;schema:object;cwd:string;model:string;tools:ToolDefinition[];deadline:RunDeadline;skills?:string[];purpose?:'classification'|'format_repair'|'stage';max_output_tokens?:number;runtime_limits?:Partial<ResolvedRuntimeLimits>;semantic_policy_hash?:string};
export function stageInputHash(input:Pick<StageExecution,'prompt'|'system_prompt'|'schema'|'model'|'tools'|'task'|'max_output_tokens'|'semantic_policy_hash'|'runtime_limits'>):string{return digest(canonicalJson({prompt:input.prompt,system_prompt:input.system_prompt,schema:input.schema,model:input.model,tool_names:input.tools.map(tool=>tool.name),context_id:input.task.context_id,capability:input.task.capability,max_output_tokens:input.max_output_tokens??8192,runtime_limits:resolveRuntimeLimits(input.runtime_limits),semantic_policy_hash:input.semantic_policy_hash??null}));}
export class StageExecutor {
  constructor(private readonly model:ModelAdapter,private readonly gate:PolicyGate,private readonly journal:JournalPort){}
  async execute(input:StageExecution):Promise<{invocation_id:string;result:unknown}> {
    parseStageTask(input.task);if(input.task.deadline!==input.deadline.generation_deadline)throw new Error('stage_deadline_mismatch');if(input.subject.project_id!==input.task.project_id||input.subject.subject_ref!==`project:${input.task.project_id}`)throw new Error('stage_subject_mismatch');
    if(input.task.execution_scope!==input.subject.execution_scope)throw new Error('stage_scope_mismatch');
    const limits=resolveRuntimeLimits(input.runtime_limits);input.deadline.requireStart();const expected=stageInputHash(input);if(expected!==input.task.input_hash)throw new Error('stage_input_hash_mismatch');
    let check=await this.gate.require(input.subject,input.task.capability,input.task.checkpoint);
    const prior=await this.journal.find(input.subject.subject_ref,expected,input.task.capability);
    if(prior&&['prepared','running','unknown'].includes(prior.status))throw new Error('request_unknown');
    if(prior?.status==='failed')throw new Error('known_failed_requires_manual');
    if(input.semantic_policy_hash&&check.semantic_policy_hash!==input.semantic_policy_hash)throw new Error('semantic_policy_changed');
    if(prior?.status==='succeeded'){const result=await this.journal.result?.(prior.invocation_id);if(result===undefined)throw new Error('completed_result_missing_requires_reconciliation');return {invocation_id:prior.invocation_id,result};}
    await this.model.preflight?.(); // Capacity/G1 admission rejection proves SDK never started; do not create an ambiguous paid intent.
    input.deadline.requireStart();
    // Admission may await remote capacity/G1 checks. Its original permission is no
    // longer current after that wait; persist the latest one before reserving a query.
    check=await this.gate.require(input.subject,input.task.capability,input.task.checkpoint);
    if(input.semantic_policy_hash&&check.semantic_policy_hash!==input.semantic_policy_hash)throw new Error('semantic_policy_changed');
    const invocation_id=`inv_${randomUUID()}`;
    await this.journal.prepare({schema_version:1,invocation_id,execution_scope:input.task.execution_scope,subject_id:input.subject.subject_ref,capability:input.task.capability,
      input_hash:expected,context_hash:input.task.context_id,policy_hash:check.policy_hash!,model:input.model,sdk_version:SDK_VERSION,status:'prepared',messages:[],
      usage:{input_tokens:0,output_tokens:0,cost_usd:null,cost_status:'unknown'},limits:{policy_check_ref:check.check_id,purpose:input.purpose??'stage',max_tools:limits.max_tools_per_batch,max_new_materials:limits.max_references_per_batch,max_output_tokens:input.max_output_tokens??8192,deadline:input.deadline.generation_deadline}});
    const cancellation=input.deadline.signal();let final:unknown;let terminal=false;let success=false;let stopped=false;let policyFailed=false;let observedSdkMessage=false;
    // The running SDK query is actively interrupted if latest trusted policy is revoked or becomes unreadable.
    const refresh=setInterval(()=>{if(stopped)return;void this.gate.check(input.subject,input.task.capability,'active_query_refresh').then(current=>{if(current.execution_permission!=='allowed'){policyFailed=true;controller.abort('policy_revoked');}}).catch(()=>{policyFailed=true;controller.abort('policy_unavailable');});},limits.policy_refresh_seconds*1000);refresh.unref();
    const controller=new AbortController();cancellation.signal.addEventListener('abort',()=>controller.abort(cancellation.signal.reason),{once:true});if(cancellation.signal.aborted)controller.abort();
    try {
      for await(const message of this.model.stream({prompt:input.prompt,system_prompt:input.system_prompt,schema:input.schema,cwd:input.cwd,vault_root:path.join(input.cwd,'projects',input.task.project_id,'draft'),model:input.model,signal:controller.signal,tools:input.tools,max_turns:limits.max_tools_per_batch,max_output_tokens:input.max_output_tokens??8192,...(input.skills?{skills:input.skills}:{})})){
        observedSdkMessage=true;
        await this.journal.observe(invocation_id,{message_id:message.message_id,summary:message.summary,usage:message.usage},{...message.observable,...(message.type==='result'&&message.result!==undefined?{structured_response:message.result}:{})});
        if(message.type==='result'){terminal=true;success=message.success===true;final=message.result;}
      }
      if(!terminal){await this.journal.finish(invocation_id,'unknown');throw new Error('request_unknown');}
      // A result error can carry paid usage: confirmed failure is not proof no model call ran and is never retried blindly.
      await this.journal.finish(invocation_id,success?'succeeded':'failed');if(!success)throw new Error('model_failed_known');if(policyFailed)throw new Error('policy_blocked');return {invocation_id,result:final};
    }catch(error){const wasAborted=controller.signal.aborted;controller.abort();
      if(error instanceof QueryNotStartedError&&!observedSdkMessage){await this.journal.observe(invocation_id,{message_id:`not_started_${invocation_id}`,summary:true,usage:{input_tokens:0,output_tokens:0,cost_usd:0,cost_status:'known'}},{request_started:false,reason:error.reason});await this.journal.finish(invocation_id,'failed');throw error;}
      if(!terminal){await this.journal.finish(invocation_id,'unknown');if(wasAborted&&input.deadline.abort_signal?.aborted)throw new Error('request_unknown:run_cancelled',{cause:error});}throw error;}
    finally{stopped=true;clearInterval(refresh);cancellation.close();}
  }
}

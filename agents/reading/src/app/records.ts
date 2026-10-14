import {Type} from '@sinclair/typebox';
import {canonicalJson,type JsonValue,type ExecutionScope,type ScopedRecordValidator,type InvocationRecord} from '../contracts/index.js';
import {READING_PROJECT_STATES,validateReadingProjectTransition} from '../contracts/transitions.js';
import {parseRunReport} from './run-records.js';
import {parsePolicyCheck} from '../policy/gate.js';
import {parseSourceHealth} from '../monitor/contracts.js';
import {parseSourceGapAudit} from './source-gap-management.js';
import {parseSourceResult,parseSourceProgress} from '../collect/records.js';
import {UtcInstantSchema} from '../contracts/utc.js';
import {parseContextBundle,parseRuntimeProject,RuntimeProjectSchema} from '../stages/records.js';
import {ReviewStageSchema} from '../stages/continuation.js';
import {WritingStageSchema} from '../stages/writing.js';
import {parseModel,CandidateSchema,SelectionSchema} from '../stages/contracts.js';
const text=Type.String({minLength:1}),optionalText=Type.Union([text,Type.Null()]);
const safeCount=Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER});
const scope=Type.Union([Type.Literal('preview'),Type.Literal('production')]);
const hostSchema=Type.Object({generation_version:safeCount,resume_stage:Type.Union([...['selection','research','writing','review'].map(v=>Type.Literal(v)),Type.Null()]),resume_policy:Type.Union(['automatic','manual','when_policy_allows','when_capacity_available'].map(v=>Type.Literal(v))),reason:optionalText,last_run_id:optionalText,batch_id:text,delivery_id:optionalText,sources_verified_at:Type.Union([UtcInstantSchema,Type.Null()])},{additionalProperties:true});
const prunedSchema=Type.Object({schema_version:Type.Literal(1),project_id:text,workspace_id:text,execution_scope:scope,state:Type.Union(['merged','closed_unmerged','skipped','preview_ready'].map(v=>Type.Literal(v))),candidate:CandidateSchema,created_at:UtcInstantSchema,completed_at:UtcInstantSchema,generation_version:safeCount,context_id:text,filename:optionalText,note_date:optionalText,delivery_id:optionalText,retention_pruned:Type.Literal(true),retention_pruned_at:UtcInstantSchema,reason:optionalText,selection:Type.Union([SelectionSchema,Type.Null()]),knowledge_increment:optionalText,usage_audit_ids:Type.Array(text),skill_commit:optionalText},{additionalProperties:false});
const projectKeys=new Set([...Object.keys(RuntimeProjectSchema.properties),...Object.keys(hostSchema.properties)]);
/** Installed only on host managers; storage protocol fixtures can retain their independent DTOs. */
export function validateHostRecords(records:Record<string,JsonValue|null>,execution_scope:ExecutionScope,workspace_id:string,context?:Parameters<ScopedRecordValidator>[3]):void{
 for(const [key,raw] of Object.entries(records)){
  if(raw===null)continue;
  if(key.startsWith('runs/')){const report=parseRunReport(raw);if(key!==`runs/${report.run_id}`||report.execution_scope!==execution_scope||report.workspace_id!==workspace_id)throw new Error('run_record_scope_identity_mismatch');for(const reference of report.policy_check_refs){const check=records['policy-checks/'+reference];if(!check||parsePolicyCheck(check).execution_scope!==execution_scope)throw new Error('run_policy_reference_missing');}}
  if(key.startsWith('policy-checks/')){const check=parsePolicyCheck(raw);if(key!==`policy-checks/${check.check_id}`||check.execution_scope!==execution_scope)throw new Error('policy_record_scope_identity_mismatch');}
  if(key==='sources/health'){const health=parseSourceHealth(raw);if(health.events.some(event=>event.workspace_id!==workspace_id||event.execution_scope!==execution_scope))throw new Error('source_health_scope_identity_mismatch');}
  if(key.startsWith('source-gap-management/')){const audit=parseSourceGapAudit(raw);if(key!=='source-gap-management/'+audit.request.management_id||audit.request.workspace_id!==workspace_id||audit.request.execution_scope!==execution_scope)throw new Error('source_gap_audit_scope_identity_mismatch');const health=parseSourceHealth(records['sources/health']);if(health.gaps[audit.request.gap_id]?.status!=='accepted'||!health.events.some(event=>event.event_id===audit.event_id&&event.position===audit.event_position&&event.gap_id===audit.request.gap_id&&event.source_id===audit.request.source_id&&event.kind==='accepted_gap'&&event.workspace_id===workspace_id&&event.execution_scope===execution_scope))throw new Error('source_gap_audit_event_missing');}
  if(/^sources\/[^/]+\/progress$/.test(key))parseSourceProgress(raw);
  if(/^sources\/[^/]+\/result$/.test(key)){const result=parseSourceResult(raw);if(result.source_id!==key.split('/')[1])throw new Error('source_result_identity_mismatch');}
  if(key.startsWith('contexts/')){const context=parseContextBundle(raw);if(key!==`contexts/${context.context_id}`)throw new Error('context_record_identity_mismatch');}
  if(!key.startsWith('projects/'))continue;
  if(typeof raw!=='object'||Array.isArray(raw))throw new Error('host_project_record_invalid');
  const row=raw as Record<string,JsonValue>;
  if(!READING_PROJECT_STATES.includes(row.state as typeof READING_PROJECT_STATES[number]))throw new Error('host_project_state_unknown');
  if(execution_scope==='preview'&&['validated','ready_for_delivery','publishing','pr_open','merged','closed_unmerged'].includes(String(row.state)))throw new Error('host_preview_delivery_state_denied');
  if(row.retention_pruned===true)parseModel(prunedSchema,row);
  else{
   const project=parseRuntimeProject(row,{allow_references:true});parseModel(hostSchema,row);
   if(Object.keys(row).some(field=>!projectKeys.has(field)))throw new Error('host_project_field_unknown');
   if(project.stage_continuation){const marker=project.stage_continuation,invocation=records['invocations/'+marker.invocation_id] as unknown as InvocationRecord|undefined;const consumed=records['consumed/'+marker.invocation_id] as Record<string,JsonValue>|undefined;const rawResponse=records['responses/'+marker.invocation_id];if(!invocation||invocation.status!=='succeeded'||invocation.subject_id!=='project:'+project.project_id||invocation.execution_scope!==execution_scope||invocation.capability!==(marker.stage==='writing'?'write':'review')||invocation.context_hash!==marker.context_id||invocation.input_hash!==marker.input_hash||!consumed||consumed.project_id!==project.project_id||consumed.reason!==marker.stage+'_batch_yield')throw new Error('stage_continuation_invocation_mismatch');const response=parseModel<{decision?:string}>(marker.stage==='writing'?WritingStageSchema:ReviewStageSchema,typeof rawResponse==='string'?JSON.parse(rawResponse):rawResponse);if(response.decision!=='batch_yield')throw new Error('stage_continuation_result_mismatch');}
   const context=records[`contexts/${project.context.context_id}`];
   if(!context||canonicalJson(parseContextBundle(context))!==canonicalJson(project.context))throw new Error('host_context_record_missing');
  }
  if(row.execution_scope!==execution_scope||row.workspace_id!==workspace_id||key!==`projects/${row.project_id}`)throw new Error('host_project_scope_identity_mismatch');
  if(context){const previous=context.previous_records[key];if(!previous||canonicalJson(previous)!==canonicalJson(raw))validateReadingProjectTransition(previous,raw,context.reason);}
 }
}

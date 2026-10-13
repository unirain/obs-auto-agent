import {Type} from '@sinclair/typebox';
import {canonicalJson,type JsonValue,type ExecutionScope,type ScopedRecordValidator} from '../contracts/index.js';
import {READING_PROJECT_STATES,validateReadingProjectTransition} from '../contracts/transitions.js';
import {parseContextBundle,parseRuntimeProject,RuntimeProjectSchema} from '../stages/records.js';
import {parseModel,CandidateSchema,SelectionSchema} from '../stages/contracts.js';
const text=Type.String({minLength:1}),optionalText=Type.Union([text,Type.Null()]);
const safeCount=Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER});
const scope=Type.Union([Type.Literal('preview'),Type.Literal('production')]);
const hostSchema=Type.Object({generation_version:safeCount,resume_stage:Type.Union([...['selection','research','writing','review'].map(v=>Type.Literal(v)),Type.Null()]),resume_policy:Type.Union(['automatic','manual','when_policy_allows','when_capacity_available'].map(v=>Type.Literal(v))),reason:optionalText,last_run_id:optionalText,batch_id:text,delivery_id:optionalText,sources_verified_at:optionalText},{additionalProperties:true});
const prunedSchema=Type.Object({schema_version:Type.Literal(1),project_id:text,workspace_id:text,execution_scope:scope,state:Type.Union(['merged','closed_unmerged','skipped','preview_ready'].map(v=>Type.Literal(v))),candidate:CandidateSchema,created_at:text,completed_at:text,generation_version:safeCount,context_id:text,filename:optionalText,note_date:optionalText,delivery_id:optionalText,retention_pruned:Type.Literal(true),retention_pruned_at:text,reason:optionalText,selection:Type.Union([SelectionSchema,Type.Null()]),knowledge_increment:optionalText,usage_audit_ids:Type.Array(text),skill_commit:optionalText},{additionalProperties:false});
const projectKeys=new Set([...Object.keys(RuntimeProjectSchema.properties),...Object.keys(hostSchema.properties)]);
/** Installed only on host managers; storage protocol fixtures can retain their independent DTOs. */
export function validateHostRecords(records:Record<string,JsonValue|null>,execution_scope:ExecutionScope,workspace_id:string,context?:Parameters<ScopedRecordValidator>[3]):void{
 for(const [key,raw] of Object.entries(records)){
  if(raw===null)continue;
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
   const context=records[`contexts/${project.context.context_id}`];
   if(!context||canonicalJson(parseContextBundle(context))!==canonicalJson(project.context))throw new Error('host_context_record_missing');
  }
  if(row.execution_scope!==execution_scope||row.workspace_id!==workspace_id||key!==`projects/${row.project_id}`)throw new Error('host_project_scope_identity_mismatch');
  if(context){const previous=context.previous_records[key];if(!previous||canonicalJson(previous)!==canonicalJson(raw))validateReadingProjectTransition(previous,raw,context.reason);}
 }
}

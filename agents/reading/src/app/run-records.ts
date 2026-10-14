import {Type,type Static} from '@sinclair/typebox';
import {TypeCompiler} from '@sinclair/typebox/compiler';
import {canonicalJson,AgentError} from '../contracts/index.js';
import {UtcInstantSchema} from '../contracts/utc.js';
import {UsageTotalsSchema} from '../contracts/schema.js';
import {SourceResultSchema,parseSourceResult} from '../collect/records.js';
import {RuntimeVersionsSchema} from '../stages/records.js';
import {READING_PROJECT_STATES} from '../contracts/transitions.js';
const text=Type.String({minLength:1}),hash=Type.String({pattern:'^[a-f0-9]{64}$'}),commit=Type.String({pattern:'^[a-f0-9]{40}$'}),strict={additionalProperties:false};
const json=Type.Recursive(self=>Type.Union([Type.Null(),Type.Boolean(),Type.Number(),Type.String(),Type.Array(self),Type.Record(Type.String(),self)]),{$id:'reading_run_json'});
export const RunProjectVersionSchema=Type.Object({project_id:text,generation_version:Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER}),context_id:hash,skill_commit:commit,skill_hash:hash,prompt_hash:hash,model:text,runtime_versions:Type.Union([RuntimeVersionsSchema,Type.Null()])},strict);
export const RunReportSchema=Type.Object({schema_version:Type.Literal(1),run_id:text,logical_key:text,workspace_id:text,execution_scope:Type.Union([Type.Literal('production'),Type.Literal('preview')]),mode:Type.Union(['preview','scheduled','resume','publish-only'].map(v=>Type.Literal(v))),input_commit:Type.Union([commit,Type.Null()]),versions:Type.Object({implementation_commit:Type.Union([commit,Type.Null()]),projects:Type.Array(RunProjectVersionSchema)},strict),policy_check_refs:Type.Array(hash,{uniqueItems:true}),started_at:UtcInstantSchema,finished_at:UtcInstantSchema,outcome:Type.Union(['success_preview','success','success_no_selection','partial','failed_collection','deferred_work'].map(v=>Type.Literal(v))),source_results:Type.Array(SourceResultSchema),project_ids:Type.Array(text,{uniqueItems:true}),usage:UsageTotalsSchema,failures:Type.Array(Type.Object({subject:text,reason:text},strict)),delivery_results:Type.Array(Type.Object({project_id:text,state:Type.Union(READING_PROJECT_STATES.map(v=>Type.Literal(v)))},strict)),blocked_projects:Type.Array(Type.Object({project_id:text,reason:text,required_action:text},strict)),image_degradations:Type.Optional(Type.Array(Type.Object({project_id:text,generation_version:Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER}),context_id:hash,details:Type.Array(text,{minItems:1})},strict))),metrics:Type.Optional(Type.Record(Type.String(),json))},strict);
export type RunReport=Static<typeof RunReportSchema>;
const validateUsage=TypeCompiler.Compile(UsageTotalsSchema);
export function parseRunUsage(raw:unknown):RunReport['usage']{if(!validateUsage.Check(raw))throw new AgentError('corrupt','Invalid run usage');return raw;}
export function parseRunProjectState(raw:string):RunReport['delivery_results'][number]['state']{if(!READING_PROJECT_STATES.includes(raw as typeof READING_PROJECT_STATES[number]))throw new AgentError('corrupt','Unknown run project state');return raw as RunReport['delivery_results'][number]['state'];}
const validate=TypeCompiler.Compile(RunReportSchema);
export function parseRunReport(raw:unknown):RunReport{
 if(!validate.Check(raw))throw new AgentError('corrupt','Invalid run report: '+[...validate.Errors(raw)].map(e=>e.path).join(','));canonicalJson(raw);
 const value=raw as RunReport;if(Date.parse(value.finished_at)<Date.parse(value.started_at))throw new AgentError('corrupt','Run report finish precedes start');
 if((value.mode==='preview')!==(value.execution_scope==='preview'))throw new AgentError('scope','Run report mode/scope mismatch');
 if(value.execution_scope==='preview'&&['success'].includes(value.outcome)||value.execution_scope==='production'&&value.outcome==='success_preview')throw new AgentError('scope','Run report outcome/scope mismatch');
 if(new Set(value.versions.projects.map(p=>p.project_id)).size!==value.versions.projects.length)throw new AgentError('corrupt','Duplicate run project versions');
 if(value.project_ids.some(id=>!value.versions.projects.some(p=>p.project_id===id)))throw new AgentError('corrupt','Run project version missing');
 for(const source of value.source_results)parseSourceResult(source);
 return value;
}

import {canonicalJson,sha256} from '../../src/contracts/index.js';
import {parseRunUsage} from '../../src/app/run-records.js';
import {verifyFrozenDataset,verifyMeasuredSamples,type freezeDataset,type LabeledSample} from './evaluation.js';
import type {EvaluationExecution,EvaluationCase} from './execute.js';

type Frozen=ReturnType<typeof freezeDataset>;
export type AggregatedEvaluation={schema_version:1;frozen_hash:string;execution_scope:'preview';layer:'live'|'local_replay';samples:LabeledSample[];cases:EvaluationCase[];executions:EvaluationExecution[]};
const subset=(a:string[],b:string[])=>a.every(id=>b.includes(id));
function validateCase(row:EvaluationCase,frozen:Frozen,execution:EvaluationExecution):void{
 const sample=frozen.samples.find(sample=>sample.id===row.sample_id);
 if(!sample||sample.split!==execution.split||row.schema_version!==1||row.source_snapshot_hash!==sample.source_snapshot_hash||typeof row.workspace_id!=='string'||row.workspace_id!==`obs-notes-hub/reading-preview/eval_${sha256(canonicalJson([execution.session,row.sample_id])).slice(0,32)}`||typeof row.revision!=='string'||!row.revision.trim()||!Array.isArray(row.run_ids)||row.run_ids.some(id=>typeof id!=='string'||!id)||new Set(row.run_ids).size!==row.run_ids.length)throw new Error('evaluation_case_binding_mismatch');
 if(row.predicted!==null&&!['collect','reject','insufficient'].includes(row.predicted))throw new Error('evaluation_prediction_invalid');
 parseRunUsage(row.usage);
 const observed=execution.samples.find(sample=>sample.id===row.sample_id);const modelReview=row.state==='preview_ready'?true:row.state==='deferred'&&row.reason==='quality_blocked'?false:null;
 if(!observed||observed.predicted!==row.predicted||observed.model_review_passed!==modelReview||observed.cost_usd!==row.usage.cost_usd||observed.known_cost_usd!==row.usage.known_cost_usd||observed.duration_ms!==row.duration_ms||observed.known_duration_ms!==row.known_duration_ms||observed.execution_scope!=='preview')throw new Error('evaluation_sample_case_mismatch');
 if(!Array.isArray(row.invocation_facts)||row.invocation_facts.length!==row.usage.invocation_count||new Set(row.invocation_facts.map(fact=>fact.invocation_id)).size!==row.invocation_facts.length||row.invocation_facts.some(fact=>!fact.invocation_id||!fact.input_hash||!fact.context_hash||!Array.isArray(fact.messages)||new Set(fact.messages.map(message=>message.message_id)).size!==fact.messages.length||fact.messages.some(message=>!message.message_id||!/^([a-f0-9]{64})$/.test(message.sha256))))throw new Error('evaluation_invocation_facts_invalid');
 if(!Number.isSafeInteger(row.known_duration_ms)||row.known_duration_ms<0||row.duration_ms!==null&&(!Number.isSafeInteger(row.duration_ms)||row.duration_ms<row.known_duration_ms))throw new Error('evaluation_duration_invalid');
 if(!Array.isArray(row.versions)||row.versions.some(version=>version.skill_commit!==frozen.versions.skill_commit||version.prompt_hash!==frozen.versions.prompt||version.model!==frozen.versions.model)||!Array.isArray(row.failures)||!Array.isArray(row.run_records)||row.run_records.some(run=>!row.run_ids.includes(run.run_id)))throw new Error('evaluation_case_versions_invalid');
 if(row.checks?.formal_upload!=='not_exercised'||row.checks.formal_url!=='not_exercised'||row.checks.github_pr!=='not_exercised')throw new Error('evaluation_scope_invalid');
}
function latest(a:EvaluationCase,b:EvaluationCase):EvaluationCase{
 if(a.workspace_id!==b.workspace_id)throw new Error('evaluation_sample_namespace_conflict');
 if(subset(a.run_ids,b.run_ids)&&subset(b.run_ids,a.run_ids)){
  if(canonicalJson(a)!==canonicalJson(b))throw new Error('evaluation_same_runs_conflict');
  return a;
 }
 if(!subset(a.run_ids,b.run_ids)&&!subset(b.run_ids,a.run_ids))throw new Error('evaluation_run_history_conflict');
 const newer=subset(a.run_ids,b.run_ids)?b:a,older=newer===b?a:b;
 if(older.run_records.some(record=>!newer.run_records.some(next=>canonicalJson(next)===canonicalJson(record)))||older.invocation_facts.some(fact=>{const next=newer.invocation_facts.find(next=>next.invocation_id===fact.invocation_id);return !next||next.input_hash!==fact.input_hash||next.context_hash!==fact.context_hash||fact.messages.some((message,index)=>canonicalJson(next.messages[index])!==canonicalJson(message));}))throw new Error('evaluation_persistent_prefix_changed');
 if(newer.usage.invocation_count<older.usage.invocation_count||newer.known_duration_ms<older.known_duration_ms)throw new Error('evaluation_observations_lost');
 return newer;
}
/** Merge cumulative sample ledgers, never sum a resumed ledger and its earlier snapshot.
 * Split selection and corpus facts stay frozen. A different namespace requires a separate comparison. */
export function mergeEvaluationExecutions(frozen:Frozen,executions:EvaluationExecution[],measured?:LabeledSample[]):AggregatedEvaluation{
 verifyFrozenDataset(frozen);if(!Array.isArray(executions)||!executions.length)throw new Error('evaluation_executions_required');
 if(measured)verifyMeasuredSamples(measured,frozen.versions);
 const cases=new Map<string,EvaluationCase>();let layer:EvaluationExecution['layer']|undefined;
 for(const execution of executions){
  if(!execution||execution.schema_version!==1||execution.frozen_hash!==frozen.frozen_hash||!['live','local_replay'].includes(execution.layer)||!['development','holdout'].includes(execution.split)||!Array.isArray(execution.cases)||typeof execution.session!=='string'||!execution.session)throw new Error('evaluation_execution_binding_mismatch');
  if(layer&&layer!==execution.layer)throw new Error('evaluation_execution_layer_conflict');layer=execution.layer;
  verifyMeasuredSamples(execution.samples,frozen.versions);const seen=new Set<string>();
  for(const row of execution.cases){validateCase(row,frozen,execution);if(seen.has(row.sample_id))throw new Error('evaluation_duplicate_execution_case');seen.add(row.sample_id);const old=cases.get(row.sample_id);cases.set(row.sample_id,old?latest(old,row):structuredClone(row));}
 }
 const samples=frozen.samples.map(fact=>{
  const human=measured?.find(sample=>sample.id===fact.id),row=cases.get(fact.id);
  const modelReview=row?.state==='preview_ready'?true:row?.state==='deferred'&&row.reason==='quality_blocked'?false:null;
  for(const key of ['predicted','model_review_passed','cost_usd','duration_ms'] as const){const observed=key==='predicted'?row?.predicted??null:key==='model_review_passed'?modelReview:key==='cost_usd'?row?.usage.cost_usd??null:row?.duration_ms??null;if(human&&human[key]!==null&&human[key]!==observed)throw new Error('evaluation_measurement_execution_conflict:'+key);}
  if(human&&((human.known_cost_usd!==undefined&&human.known_cost_usd!==null&&human.known_cost_usd!==row?.usage.known_cost_usd)||(human.known_duration_ms!==undefined&&human.known_duration_ms!==null&&human.known_duration_ms!==row?.known_duration_ms)||(human.execution_scope!==undefined&&human.execution_scope!==null&&human.execution_scope!==(row?'preview':null))))throw new Error('evaluation_measurement_execution_conflict:observations');
  return {...fact,...(human??{}),predicted:row?.predicted??null,model_review_passed:modelReview,cost_usd:row?.usage.cost_usd??null,known_cost_usd:row?.usage.known_cost_usd??null,duration_ms:row?.duration_ms??null,known_duration_ms:row?.known_duration_ms??null,execution_scope:row?'preview' as const:null,qualified:human?.qualified??false};
 });
 verifyMeasuredSamples(samples,frozen.versions);
 return {schema_version:1,frozen_hash:frozen.frozen_hash,execution_scope:'preview',layer:layer!,samples,cases:[...cases.values()].sort((a,b)=>a.sample_id.localeCompare(b.sample_id)),executions:structuredClone(executions)};
}

import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {canonicalJson,sha256} from '../../src/contracts/index.js';
import {buildUsageLedger,detailedUsage} from '../../src/workspace/usage.js';
import {freezeDataset,evaluate,type LabeledSample} from './evaluation.js';
import {mergeEvaluationExecutions} from './aggregate.js';
import type {EvaluationExecution,EvaluationCase} from './execute.js';
const exec=promisify(execFile);
function fixture(){
 const samples:LabeledSample[]=Array.from({length:30},(_,index)=>({id:String(index),url:`https://example.org/${index}`,source_id:index%2?'langchain_blog':'claude_resources',note_paths:[],human_label:'collect',predicted:null,split:index<10?'holdout':'development',human_claims_supported:null,human_claims_checked:null,model_review_passed:null,numeric_errors:null,interface_errors:null,link_errors:null,mechanism_score:null,tradeoff_score:null,boundary_score:null,figure_score:null,feedback:null,cost_usd:null,duration_ms:null,qualified:false,source_snapshot_hash:sha256('body '+index)}));
 const frozen=freezeDataset(samples,{config:sha256('config'),prompt:sha256('prompts'),model:'deepseek-flash',skill_commit:'a'.repeat(40)});
 const execution=(split:'holdout'|'development',ids=samples.filter(sample=>sample.split===split).map(sample=>sample.id)):EvaluationExecution=>{
  const cases:EvaluationCase[]=ids.map(id=>{
   const unknown=id==='0',count=unknown?3:1,run='run_'+id+'_1';
   return {schema_version:1,sample_id:id,workspace_id:'obs-notes-hub/reading-preview/eval_'+sha256(canonicalJson(['test',id])).slice(0,32),revision:sha256('revision '+id),project_id:'p'+id,state:'preview_ready',reason:null,predicted:'collect',source_snapshot_hash:frozen.samples.find(sample=>sample.id===id)!.source_snapshot_hash!,context_id:sha256('context '+id),versions:[{project_id:'p'+id,generation_version:1,context_id:sha256('context '+id),skill_commit:frozen.versions.skill_commit,skill_hash:sha256('skills'),prompt_hash:frozen.versions.prompt,model:frozen.versions.model,runtime_versions:null}],run_ids:[run],run_records:[{run_id:run,input_commit:null,implementation_commit:null,policy_check_refs:[]}],invocation_facts:Array.from({length:count},(_,i)=>({invocation_id:'inv_'+id+'_'+i,input_hash:sha256('input '+id+' '+i),context_hash:sha256('context '+id),messages:[{message_id:'m'+i,sha256:sha256('message '+id+' '+i)}]})),usage:{...buildUsageLedger([]).total,input_tokens:10,output_tokens:3,invocation_count:count,unknown_invocations:unknown?1:0,unresolved_invocations:unknown?1:0,...(unknown?{cost_status:'unknown' as const,cost_usd:null,known_cost_usd:4}:{cost_status:'known' as const,cost_usd:2,known_cost_usd:2})},known_duration_ms:unknown?20:10,duration_ms:unknown?null:10,failures:unknown?[{subject:'p0',reason:'request_unknown'}]:[],artifact_hashes:{},checks:{formal_upload:'not_exercised',formal_url:'not_exercised',github_pr:'not_exercised'}};
  });
  return {schema_version:1,frozen_hash:frozen.frozen_hash,session:'test',layer:'local_replay',split,cases,samples:samples.map(sample=>{const row=cases.find(row=>row.sample_id===sample.id);return {...sample,predicted:row?.predicted??null,model_review_passed:row?true:null,cost_usd:row?.usage.cost_usd??null,known_cost_usd:row?.usage.known_cost_usd??null,duration_ms:row?.duration_ms??null,known_duration_ms:row?.known_duration_ms??null,execution_scope:row?'preview':null};}),quality_gate:'awaiting_user_confirmation',model_version_status:'identifier_only_unverified'};
 };
 return {frozen,execution};
}
it('development and holdout merge retains incomplete priced-query and duration lower bounds, split/scope totals and each qualified output',()=>{
 const f=fixture(),merged=mergeEvaluationExecutions(f.frozen,[f.execution('development'),f.execution('holdout')]);merged.samples[0]!.qualified=true;
 const report=evaluate(merged.samples,f.frozen.versions);
 expect(report).toMatchObject({execution_scope:'preview',cost:{known_usd:62,total_usd:null,unknown_samples:1,cost_per_qualified:null,qualified_count:1},duration:{known_ms:310,total_ms:null,unknown_samples:1,duration_per_qualified:null},by_split:{development:{cost:{known_usd:40,total_usd:40},duration:{total_ms:200},selection:{observed_count:20}},holdout:{cost:{known_usd:22,total_usd:null},duration:{known_ms:110,total_ms:null}}},by_scope:{preview:{sample_count:30,cost:{known_usd:62,total_usd:null}},production:{sample_count:0,cost:{known_usd:null,total_usd:null}}},qualified_outputs:[{id:'0',execution_scope:'preview',cost_usd:null,known_cost_usd:4,duration_ms:null,known_duration_ms:20}]});
 expect(merged.cases[0]!.failures).toEqual([{subject:'p0',reason:'request_unknown'}]);
});
it('all unobserved remains unknown, while genuinely observed zero costs stay zero',()=>{
 const f=fixture(),rows=structuredClone(f.frozen.samples);rows.forEach(row=>row.predicted='collect');
 expect(evaluate(rows,f.frozen.versions)).toMatchObject({execution_scope:'unknown',cost:{known_usd:null,total_usd:null,observed_samples:0},duration:{known_ms:null,total_ms:null,observed_samples:0}});
 rows.forEach(row=>{row.cost_usd=0;row.duration_ms=5;row.execution_scope='preview';});rows[0]!.qualified=true;
 expect(evaluate(rows,f.frozen.versions)).toMatchObject({cost:{known_usd:0,total_usd:0,cost_per_qualified:0},duration:{known_ms:150,total_ms:150,duration_per_qualified:150}});
});
it('cumulative cold snapshots retain exact immutable invocation-message prefixes and use the latest ledger once',()=>{
 const f=fixture(),old=f.execution('holdout'),next=f.execution('holdout',['0']);const row=next.cases[0]!;row.run_ids.push('run_0_2');row.run_records.push({run_id:'run_0_2',input_commit:null,implementation_commit:null,policy_check_refs:[]});row.known_duration_ms=30;next.samples[0]!.known_duration_ms=30;
 const merged=mergeEvaluationExecutions(f.frozen,[old,next,old]);expect(merged.samples[0]).toMatchObject({known_cost_usd:4,cost_usd:null,known_duration_ms:30,duration_ms:null});expect(merged.cases).toHaveLength(10);expect(merged.cases.find(row=>row.sample_id==='0')!.usage.invocation_count).toBe(3);
 const lost=structuredClone(next);lost.cases[0]!.invocation_facts[0]!.messages[0]!.sha256=sha256('changed charge observation');expect(()=>mergeEvaluationExecutions(f.frozen,[old,lost])).toThrow('persistent_prefix_changed');
 const missing=structuredClone(next);missing.cases[0]!.invocation_facts[0]!.invocation_id='replacement-unbound';expect(()=>mergeEvaluationExecutions(f.frozen,[old,missing])).toThrow('persistent_prefix_changed');
});
it('merge rejects changed corpus, contradictory sample/case values, mixed live/replay layers and foreign sample namespaces',()=>{
 const f=fixture(),original=f.execution('holdout');
 for(const change of [(e:EvaluationExecution)=>e.samples[0]!.predicted='reject',(e:EvaluationExecution)=>e.cases[0]!.usage.known_cost_usd=5,(e:EvaluationExecution)=>e.cases[0]!.duration_ms=30]){const wrong=structuredClone(original);change(wrong);expect(()=>mergeEvaluationExecutions(f.frozen,[wrong])).toThrow('sample_case_mismatch');}
 const labels=structuredClone(original);labels.samples[0]!.human_label='reject';expect(()=>mergeEvaluationExecutions(f.frozen,[labels])).toThrow('frozen_dataset_binding_mismatch');
 const live=structuredClone(original);live.layer='live';expect(()=>mergeEvaluationExecutions(f.frozen,[original,live])).toThrow('layer_conflict');
 const other=structuredClone(original);other.session='other';other.cases.forEach(row=>row.workspace_id='obs-notes-hub/reading-preview/eval_'+sha256(canonicalJson(['other',row.sample_id])).slice(0,32));expect(()=>mergeEvaluationExecutions(f.frozen,[original,other])).toThrow('namespace_conflict');
});
it('CLI merges complete split executions and reports bound preview scope, lower bounds, failures and qualified per-output duration without paid calls',async()=>{
 const f=fixture(),root=await mkdtemp(join(tmpdir(),'quality-aggregate-'));try{
  const frozen=join(root,'frozen.json'),development=join(root,'development.json'),holdout=join(root,'holdout.json'),merged=join(root,'merged.json'),measured=join(root,'measured.json'),report=join(root,'report.json');
  await writeFile(frozen,JSON.stringify(f.frozen));await writeFile(development,JSON.stringify(f.execution('development')));await writeFile(holdout,JSON.stringify(f.execution('holdout')));
  await exec('npx',['tsx','agents/reading/evals/quality/run.ts','merge','--frozen',frozen,'--execution',development,'--execution',holdout,'--output',merged]);const input=JSON.parse(await readFile(merged,'utf8'));input.samples[1].qualified=true;await writeFile(measured,JSON.stringify(input));
  await exec('npx',['tsx','agents/reading/evals/quality/run.ts','report','--input',measured,'--frozen',frozen,'--output',report]);const actual=JSON.parse(await readFile(report,'utf8'));expect(actual).toMatchObject({execution_scope:'preview',layer:'local_replay',quality_gate:'awaiting_user_confirmation',evaluation:{cost:{known_usd:62,total_usd:null},duration:{known_ms:310,total_ms:null},qualified_outputs:[{id:'1',cost_usd:2,duration_ms:10}]}});expect(actual.execution_cases).toHaveLength(30);expect(actual.execution_cases[0].failures).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
});


it('a late whole-query summary below the earlier priced steps preserves both receipt hashes and the workspace unknown-total semantics without double counting',()=>{
 const f=fixture(),older=f.execution('holdout',['1']),newer=structuredClone(older);
 const step={message_id:'priced-step',summary:false,usage:{input_tokens:10,output_tokens:2,cost_usd:5,cost_status:'known' as const}};
 const summary={message_id:'whole-query-summary',summary:true,usage:{input_tokens:10,output_tokens:2,cost_usd:4,cost_status:'known' as const}};
 const before=detailedUsage([step]),after=detailedUsage([step,summary]);
 expect(before).toMatchObject({cost_usd:5,known_cost_usd:5});
 // Current workspace policy marks contradictory pricing unknown. It neither chooses $4 nor sums $9.
 expect(after).toMatchObject({cost_usd:null,cost_status:'unknown',known_cost_usd:5});
 const update=(execution:EvaluationExecution,usage:typeof before,messages:typeof step[])=>{
  const row=execution.cases[0]!;row.usage={...row.usage,cost_usd:null,cost_status:'unknown',known_cost_usd:usage.known_cost_usd,unknown_invocations:1};
  row.invocation_facts[0]!.messages=messages.map(message=>({message_id:message.message_id,sha256:sha256(canonicalJson(message))}));
  execution.samples[1]!.cost_usd=null;execution.samples[1]!.known_cost_usd=usage.known_cost_usd;
 };
 update(older,before,[step]);update(newer,after,[step,summary]);newer.cases[0]!.run_ids.push('run_1_2');newer.cases[0]!.run_records.push({run_id:'run_1_2',input_commit:null,implementation_commit:null,policy_check_refs:[]});
 const merged=mergeEvaluationExecutions(f.frozen,[older,newer]);expect(merged.samples[1]).toMatchObject({cost_usd:null,known_cost_usd:5});expect(merged.cases[0]!.invocation_facts[0]!.messages).toHaveLength(2);
 const altered=structuredClone(newer);altered.cases[0]!.invocation_facts[0]!.messages[0]!.sha256=sha256('changed old priced step');expect(()=>mergeEvaluationExecutions(f.frozen,[older,altered])).toThrow('persistent_prefix_changed');
});

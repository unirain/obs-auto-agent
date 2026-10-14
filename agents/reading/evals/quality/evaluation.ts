import {digest} from '../../src/stages/contracts.js';
import {canonicalJson} from '../../src/contracts/index.js';
import {normalizeUrl} from '../../src/collect/identity.js';
export type QualityLabel='collect'|'reject'|'insufficient';
export type LabeledSample={id:string;url:string;source_id:string;note_paths:string[];human_label:QualityLabel|null;predicted:QualityLabel|null;split:'development'|'holdout';human_claims_supported:number|null;human_claims_checked:number|null;
  model_review_passed:boolean|null;numeric_errors:number|null;interface_errors:number|null;link_errors:number|null;mechanism_score:number|null;tradeoff_score:number|null;boundary_score:number|null;figure_score:number|null;
  feedback:'merged'|'modified_then_merged'|'closed_unmerged'|'pending'|null;cost_usd:number|null;duration_ms:number|null;qualified:boolean;title?:string;source_snapshot_hash?:string|null;execution_scope?:'preview'|'production'|null;known_cost_usd?:number|null;known_duration_ms?:number|null};
export type EvalVersions={config:string;prompt:string;model:string;skill_commit:string;samples_hash:string};
const ratio=(numerator:number,denominator:number):number|null=>denominator?numerator/denominator:null;
export function validateSamples(samples:LabeledSample[],requireLabels=false):void{
 if(!Array.isArray(samples)||samples.length<30||samples.filter(sample=>sample.split==='holdout').length<10)throw new Error('human_labels_and_holdout_required');
 const ids=new Set<string>(),urls=new Set<string>();
 for(const sample of samples){
  const fields=['id','url','source_id','note_paths','human_label','predicted','split','human_claims_supported','human_claims_checked','model_review_passed','numeric_errors','interface_errors','link_errors','mechanism_score','tradeoff_score','boundary_score','figure_score','feedback','cost_usd','duration_ms','qualified','title','source_snapshot_hash','execution_scope','known_cost_usd','known_duration_ms'];
  if(Object.keys(sample??{}).some(key=>!fields.includes(key)))throw new Error('evaluation_field_unknown');
  if(!sample||typeof sample.id!=='string'||!sample.id||ids.has(sample.id))throw new Error('dataset_duplicate_or_invalid_id');ids.add(sample.id);
  if(sample.title!==undefined&&typeof sample.title!=='string')throw new Error('evaluation_title_invalid');
  const url=normalizeUrl(sample.url);if(urls.has(url))throw new Error('dataset_duplicate_url');urls.add(url);
  if(!['langchain_blog','claude_resources'].includes(sample.source_id)||!['development','holdout'].includes(sample.split))throw new Error('dataset_identity_invalid');
  if(!Array.isArray(sample.note_paths)||sample.note_paths.some(path=>!path.startsWith('Organize Notes By AI/')||!path.endsWith('.md')||path.split('/').includes('..')||path.includes('\\')||path.includes('\0')))throw new Error('dataset_note_path_invalid');
  for(const label of [sample.human_label,sample.predicted])if(label!==null&&!['collect','reject','insufficient'].includes(label))throw new Error('evaluation_label_invalid');
  if(requireLabels&&sample.human_label===null)throw new Error('human_labels_and_holdout_required');
  for(const field of ['human_claims_supported','human_claims_checked','numeric_errors','interface_errors','link_errors','mechanism_score','tradeoff_score','boundary_score','figure_score','duration_ms'] as const){const value=sample[field];if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw new Error('evaluation_observation_invalid:'+field);}
  if(sample.human_claims_supported!==null&&(sample.human_claims_checked===null||sample.human_claims_supported>sample.human_claims_checked))throw new Error('claim_support_exceeds_checked');
  if(sample.execution_scope!==undefined&&sample.execution_scope!==null&&!['preview','production'].includes(sample.execution_scope))throw new Error('evaluation_scope_invalid');
  if(sample.known_cost_usd!==undefined&&sample.known_cost_usd!==null&&(!Number.isFinite(sample.known_cost_usd)||sample.known_cost_usd<0||sample.cost_usd!==null&&sample.known_cost_usd>sample.cost_usd))throw new Error('evaluation_known_cost_invalid');
  if(sample.known_duration_ms!==undefined&&sample.known_duration_ms!==null&&(!Number.isSafeInteger(sample.known_duration_ms)||sample.known_duration_ms<0||sample.duration_ms!==null&&sample.known_duration_ms>sample.duration_ms))throw new Error('evaluation_known_duration_invalid');
  if(sample.cost_usd!==null&&(!Number.isFinite(sample.cost_usd)||sample.cost_usd<0))throw new Error('evaluation_cost_invalid');
  if(sample.model_review_passed!==null&&typeof sample.model_review_passed!=='boolean'||typeof sample.qualified!=='boolean')throw new Error('evaluation_review_invalid');
  if(sample.feedback!==null&&!['merged','modified_then_merged','closed_unmerged','pending'].includes(sample.feedback))throw new Error('evaluation_feedback_invalid');
  if(sample.source_snapshot_hash!==undefined&&sample.source_snapshot_hash!==null&&!/^[a-f0-9]{64}$/.test(sample.source_snapshot_hash))throw new Error('evaluation_source_version_invalid');
 }
}
function corpus(samples:LabeledSample[]){return samples.map(sample=>({id:sample.id,url:normalizeUrl(sample.url),source_id:sample.source_id,title:sample.title??null,note_paths:[...sample.note_paths].sort(),human_label:sample.human_label,split:sample.split,source_snapshot_hash:sample.source_snapshot_hash??null}));}
function validateVersions(versions:Omit<EvalVersions,'samples_hash'>):void{if(!versions||Object.keys(versions).some(key=>!['config','prompt','model','skill_commit','samples_hash'].includes(key))||typeof versions.model!=='string')throw new Error('evaluation_versions_invalid');if(!/^[a-f0-9]{64}$/.test(versions.config)||!/^[a-f0-9]{64}$/.test(versions.prompt)||!/^[a-f0-9]{40}$/.test(versions.skill_commit)||!versions.model.trim())throw new Error('evaluation_versions_invalid');}
export function freezeDataset(samples:LabeledSample[],versions:Omit<EvalVersions,'samples_hash'>):{samples:LabeledSample[];versions:EvalVersions;frozen_hash:string}{
 validateSamples(samples,true);validateVersions(versions);
 if(samples.some(sample=>!sample.source_snapshot_hash))throw new Error('source_versions_required_for_freeze');
 const frozen=structuredClone(samples);const metadata={...versions,samples_hash:digest(canonicalJson(corpus(frozen)))};return {samples:frozen,versions:metadata,frozen_hash:digest(canonicalJson(metadata))};
}
export function verifyFrozenDataset(value:ReturnType<typeof freezeDataset>):void{validateSamples(value.samples,true);validateVersions(value.versions);if(value.samples.some(sample=>!sample.source_snapshot_hash)||digest(canonicalJson(corpus(value.samples)))!==value.versions.samples_hash||digest(canonicalJson(value.versions))!==value.frozen_hash)throw new Error('frozen_dataset_binding_mismatch');}
export function heldoutExclusion(samples:LabeledSample[]):{urls:Set<string>;note_paths:Set<string>}{const heldout=samples.filter(sample=>sample.split==='holdout');return {urls:new Set(heldout.map(sample=>normalizeUrl(sample.url))),note_paths:new Set(heldout.flatMap(sample=>sample.note_paths))};}
export function verifyMeasuredSamples(samples:LabeledSample[],versions:EvalVersions):void {
 validateSamples(samples,true);validateVersions(versions);
 if(digest(canonicalJson(corpus(samples)))!==versions.samples_hash)throw new Error('frozen_dataset_binding_mismatch');
}
function consumption(samples:LabeledSample[]){
 const qualified=samples.filter(sample=>sample.qualified).length;
 const costObserved=samples.map(sample=>sample.cost_usd??sample.known_cost_usd??null);
 const durationObserved=samples.map(sample=>sample.duration_ms??sample.known_duration_ms??null);
 const knownCost=costObserved.reduce<number>((sum,value)=>sum+(value??0),0);
 const knownDuration=durationObserved.reduce<number>((sum,value)=>sum+(value??0),0);
 if(!Number.isFinite(knownCost)||!Number.isSafeInteger(knownDuration))throw new Error('evaluation_aggregate_overflow');
 const observedCostCount=costObserved.filter(value=>value!==null).length,observedDurationCount=durationObserved.filter(value=>value!==null).length;
 const costKnown=samples.length>0&&samples.every(sample=>sample.cost_usd!==null),durationKnown=samples.length>0&&samples.every(sample=>sample.duration_ms!==null);
 return {cost:{known_usd:observedCostCount?knownCost:null,total_usd:costKnown?knownCost:null,unknown_samples:samples.filter(sample=>sample.cost_usd===null).length,observed_samples:observedCostCount,cost_per_qualified:costKnown?ratio(knownCost,qualified):null,qualified_count:qualified},
 duration:{known_ms:observedDurationCount?knownDuration:null,total_ms:durationKnown?knownDuration:null,unknown_samples:samples.filter(sample=>sample.duration_ms===null).length,observed_samples:observedDurationCount,duration_per_qualified:durationKnown?ratio(knownDuration,qualified):null,qualified_count:qualified}};
}
function selectionMetrics(samples:LabeledSample[]){
 const observed=samples.filter(sample=>sample.predicted!==null),truePositive=observed.filter(sample=>sample.human_label==='collect'&&sample.predicted==='collect').length;
 const predictedPositive=observed.filter(sample=>sample.predicted==='collect').length,actualPositive=observed.filter(sample=>sample.human_label==='collect').length,insufficient=observed.filter(sample=>sample.human_label==='insufficient');
 return {sample_count:samples.length,observed_count:observed.length,unpredicted_count:samples.length-observed.length,precision:{value:ratio(truePositive,predictedPositive),numerator:truePositive,denominator:predictedPositive},recall:{value:ratio(truePositive,actualPositive),numerator:truePositive,denominator:actualPositive},insufficient_recognition:{value:ratio(insufficient.filter(sample=>sample.predicted==='insufficient').length,insufficient.length),denominator:insufficient.length}};
}
export function evaluate(samples:LabeledSample[],versions:EvalVersions):Record<string,unknown>{
  verifyMeasuredSamples(samples,versions);
  const holdout=samples.filter(sample=>sample.split==='holdout');if(holdout.some(sample=>sample.human_label===null||sample.predicted===null))throw new Error('evaluation_labels_missing');
  const truePositive=holdout.filter(sample=>sample.human_label==='collect'&&sample.predicted==='collect').length;
  const predictedPositive=holdout.filter(sample=>sample.predicted==='collect').length;const actualPositive=holdout.filter(sample=>sample.human_label==='collect').length;
  const insufficient=holdout.filter(sample=>sample.human_label==='insufficient');const checked=holdout.filter(sample=>sample.human_claims_checked!==null&&sample.human_claims_supported!==null);
  const claimsSupported=checked.reduce((sum,sample)=>sum+sample.human_claims_supported!,0),claimsChecked=checked.reduce((sum,sample)=>sum+sample.human_claims_checked!,0);
  if(!Number.isSafeInteger(claimsSupported)||!Number.isSafeInteger(claimsChecked))throw new Error('evaluation_aggregate_overflow');
  const mean=(key:'mechanism_score'|'tradeoff_score'|'boundary_score'|'figure_score')=>{const observed=holdout.filter(sample=>sample[key]!==null);const total=observed.reduce((sum,sample)=>sum+sample[key]!,0);if(!Number.isSafeInteger(total))throw new Error('evaluation_aggregate_overflow');return {value:ratio(total,observed.length),denominator:observed.length};};
  return {versions,sample_count:samples.length,holdout_count:holdout.length,selection:{precision:{value:ratio(truePositive,predictedPositive),numerator:truePositive,denominator:predictedPositive},recall:{value:ratio(truePositive,actualPositive),numerator:truePositive,denominator:actualPositive},
    insufficient_recognition:{value:ratio(insufficient.filter(sample=>sample.predicted==='insufficient').length,insufficient.length),denominator:insufficient.length}},
    human:{claim_support:{value:ratio(claimsSupported,claimsChecked),numerator:claimsSupported,denominator:claimsChecked},mechanism:mean('mechanism_score'),tradeoffs:mean('tradeoff_score'),boundary:mean('boundary_score'),figures:mean('figure_score')},
    model:{passed:holdout.filter(sample=>sample.model_review_passed===true).length,checked:holdout.filter(sample=>sample.model_review_passed!==null).length},
    feedback:Object.fromEntries(['merged','modified_then_merged','closed_unmerged','pending'].map(status=>[status,samples.filter(sample=>sample.feedback===status).length])),
    ...consumption(samples),
    execution_scope:samples.every(sample=>sample.execution_scope==='preview')?'preview':samples.every(sample=>sample.execution_scope==='production')?'production':samples.every(sample=>!sample.execution_scope)?'unknown':'mixed',
    by_scope:Object.fromEntries(['preview','production','unknown'].map(scope=>{const rows=samples.filter(sample=>(sample.execution_scope??'unknown')===scope);return [scope,{sample_count:rows.length,...consumption(rows)}];})),
    by_split:Object.fromEntries(['development','holdout'].map(split=>{const rows=samples.filter(sample=>sample.split===split);return [split,{selection:selectionMetrics(rows),...consumption(rows)}];})),
    qualified_outputs:samples.filter(sample=>sample.qualified).map(sample=>({id:sample.id,execution_scope:sample.execution_scope??'unknown',cost_usd:sample.cost_usd,known_cost_usd:sample.cost_usd??sample.known_cost_usd??null,duration_ms:sample.duration_ms,known_duration_ms:sample.duration_ms??sample.known_duration_ms??null})),
    unchecked_observations:{claims:holdout.filter(sample=>sample.human_claims_checked===null||sample.human_claims_supported===null).length,numeric:holdout.filter(sample=>sample.numeric_errors===null).length,interfaces:holdout.filter(sample=>sample.interface_errors===null).length,links:holdout.filter(sample=>sample.link_errors===null).length},
    errors:holdout.filter(sample=>sample.predicted!==sample.human_label||sample.numeric_errors||sample.interface_errors||sample.link_errors).map(sample=>({id:sample.id,human:sample.human_label,predicted:sample.predicted,numeric:sample.numeric_errors,interface:sample.interface_errors,link:sample.link_errors}))};
}

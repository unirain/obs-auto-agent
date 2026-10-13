import {digest} from '../../src/stages/contracts.js';
export type QualityLabel='collect'|'reject'|'insufficient';
export type LabeledSample={id:string;url:string;source_id:string;note_paths:string[];human_label:QualityLabel|null;predicted:QualityLabel|null;split:'development'|'holdout';human_claims_supported:number|null;human_claims_checked:number|null;
  model_review_passed:boolean|null;numeric_errors:number|null;interface_errors:number|null;link_errors:number|null;mechanism_score:number|null;tradeoff_score:number|null;boundary_score:number|null;figure_score:number|null;
  feedback:'merged'|'modified_then_merged'|'closed_unmerged'|'pending'|null;cost_usd:number|null;duration_ms:number|null;qualified:boolean};
export type EvalVersions={config:string;prompt:string;model:string;skill_commit:string;samples_hash:string};
const ratio=(numerator:number,denominator:number):number|null=>denominator?numerator/denominator:null;
export function freezeDataset(samples:LabeledSample[],versions:Omit<EvalVersions,'samples_hash'>):{samples:LabeledSample[];versions:EvalVersions;frozen_hash:string}{
  if(samples.length<30||samples.filter(sample=>sample.split==='holdout').length<10||samples.some(sample=>sample.human_label===null))throw new Error('human_labels_and_holdout_required');
  if(new Set(samples.map(sample=>sample.url)).size!==samples.length)throw new Error('dataset_duplicate_url');
  const frozen=structuredClone(samples);const metadata={...versions,samples_hash:digest(JSON.stringify(frozen))};return {samples:frozen,versions:metadata,frozen_hash:digest(JSON.stringify(metadata))};
}
export function heldoutExclusion(samples:LabeledSample[]):{urls:Set<string>;note_paths:Set<string>}{const heldout=samples.filter(sample=>sample.split==='holdout');return {urls:new Set(heldout.map(sample=>sample.url)),note_paths:new Set(heldout.flatMap(sample=>sample.note_paths))};}
export function evaluate(samples:LabeledSample[],versions:EvalVersions):Record<string,unknown>{
  const holdout=samples.filter(sample=>sample.split==='holdout');if(holdout.some(sample=>sample.human_label===null||sample.predicted===null))throw new Error('evaluation_labels_missing');
  const truePositive=holdout.filter(sample=>sample.human_label==='collect'&&sample.predicted==='collect').length;
  const predictedPositive=holdout.filter(sample=>sample.predicted==='collect').length;const actualPositive=holdout.filter(sample=>sample.human_label==='collect').length;
  const insufficient=holdout.filter(sample=>sample.human_label==='insufficient');const checked=holdout.filter(sample=>sample.human_claims_checked!==null&&sample.human_claims_supported!==null);
  const claimsSupported=checked.reduce((sum,sample)=>sum+sample.human_claims_supported!,0),claimsChecked=checked.reduce((sum,sample)=>sum+sample.human_claims_checked!,0);
  const knownCosts=samples.filter(sample=>sample.cost_usd!==null);const knownTotal=knownCosts.reduce((sum,sample)=>sum+sample.cost_usd!,0);const qualified=samples.filter(sample=>sample.qualified).length;
  const mean=(key:'mechanism_score'|'tradeoff_score'|'boundary_score'|'figure_score')=>{const observed=holdout.filter(sample=>sample[key]!==null);return {value:ratio(observed.reduce((sum,sample)=>sum+sample[key]!,0),observed.length),denominator:observed.length};};
  return {versions,sample_count:samples.length,holdout_count:holdout.length,selection:{precision:{value:ratio(truePositive,predictedPositive),numerator:truePositive,denominator:predictedPositive},recall:{value:ratio(truePositive,actualPositive),numerator:truePositive,denominator:actualPositive},
    insufficient_recognition:{value:ratio(insufficient.filter(sample=>sample.predicted==='insufficient').length,insufficient.length),denominator:insufficient.length}},
    human:{claim_support:{value:ratio(claimsSupported,claimsChecked),numerator:claimsSupported,denominator:claimsChecked},mechanism:mean('mechanism_score'),tradeoffs:mean('tradeoff_score'),boundary:mean('boundary_score'),figures:mean('figure_score')},
    model:{passed:holdout.filter(sample=>sample.model_review_passed===true).length,checked:holdout.filter(sample=>sample.model_review_passed!==null).length},
    feedback:Object.fromEntries(['merged','modified_then_merged','closed_unmerged','pending'].map(status=>[status,samples.filter(sample=>sample.feedback===status).length])),
    cost:{known_usd:knownTotal,total_usd:knownCosts.length===samples.length?knownTotal:null,unknown_samples:samples.length-knownCosts.length,cost_per_qualified:knownCosts.length===samples.length?ratio(knownTotal,qualified):null,qualified_count:qualified},
    errors:holdout.filter(sample=>sample.predicted!==sample.human_label||sample.numeric_errors||sample.interface_errors||sample.link_errors).map(sample=>({id:sample.id,human:sample.human_label,predicted:sample.predicted,numeric:sample.numeric_errors,interface:sample.interface_errors,link:sample.link_errors}))};
}

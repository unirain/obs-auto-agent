import {canonicalJson} from '../contracts/index.js';
import {classificationBinding} from '../policy/classification.js';
import type {RuntimeEnvironment,RuntimeProject} from './driver.js';
export class TypedSourceChange extends Error{readonly kind='source_changed';constructor(readonly old_hash:string,readonly new_hash:string,readonly url:string){super('source_version_changed_requires_generation');}}
export type SemanticSettlement={previous:RuntimeProject;next:RuntimeProject;reason:'semantic_policy_changed'|'classification_conflict';from_semantic_hash:string|null;to_semantic_hash:string};
export type SemanticSettlementResult={status:'committed';archived_invocation_ids:string[]}|{status:'request_unknown'};
/** A known outcome is archived by the host in the same checkpoint as this replacement binding. Unknown calls are never reset here. */
export async function prepareSemanticBinding(project:RuntimeProject,environment:RuntimeEnvironment,body_hash:string,semantic_hash:string,conflict=false):Promise<RuntimeProject>{
  const old=project.classification;if(old?.source_snapshot_hash!==body_hash&&old!==null)throw new TypedSourceChange(old!.source_snapshot_hash,body_hash,project.candidate.url);
  const same=old?.semantic_policy_hash===semantic_hash;
  if(same&&!conflict)return project;
  if(old===null&&project.pending_query===null){project.classification=classificationBinding(null,project.candidate.candidate_id,body_hash,semantic_hash);return project;}
  if(!environment.settle_semantic_binding)throw new Error('semantic_binding_settlement_unavailable');
  const next=structuredClone(project);next.classification=classificationBinding(old,next.candidate.candidate_id,body_hash,semantic_hash);
  if(conflict&&next.classification)next.classification={...next.classification,credential:null,pending:false};
  next.pending_query=null;next.reclassification_history=[...(project.reclassification_history??[]),{old_binding:old,reason:conflict?'classification_conflict':'semantic_policy_changed',new_semantic_hash:semantic_hash,recorded_at:new Date().toISOString()}];
  const response=await environment.settle_semantic_binding({previous:structuredClone(project),next,reason:conflict?'classification_conflict':'semantic_policy_changed',from_semantic_hash:old?.semantic_policy_hash??null,to_semantic_hash:semantic_hash});
  if(response.status==='request_unknown')throw new Error('request_unknown');
  // Keep history an explicit immutable fact; the host's atomic archive checkpoint already persisted the replacement.
  if(canonicalJson(next.context)!==canonicalJson(project.context)||canonicalJson(next.counters)!==canonicalJson(project.counters))throw new Error('semantic_settlement_changed_generation');
  return next;
}

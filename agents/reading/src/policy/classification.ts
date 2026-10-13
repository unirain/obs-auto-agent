import { ClassificationSchema,digest,parseModel,type Classification } from '../stages/contracts.js';
import type { ClassificationCredential } from './gate.js';
export type ClassificationState={candidate_id:string;source_snapshot_hash:string;semantic_policy_hash:string;attempts:number;format_repairs:number;pending:boolean;credential:ClassificationCredential|null};
export function classificationBinding(previous:ClassificationState|null,candidate_id:string,source_snapshot_hash:string,semantic_policy_hash:string):ClassificationState {
  if(previous?.candidate_id===candidate_id&&previous.source_snapshot_hash===source_snapshot_hash&&previous.semantic_policy_hash===semantic_policy_hash)return previous;
  return {candidate_id,source_snapshot_hash,semantic_policy_hash,attempts:0,format_repairs:0,pending:false,credential:null};
}
/** Every query, including format repair, consumes the same persisted two-query allowance. */
export function reserveClassification(state:ClassificationState,formatRepair=false):ClassificationState {
  if(state.attempts>=2||(formatRepair&&state.format_repairs>=1))throw new Error('policy_review_required');
  return {...state,pending:true,attempts:state.attempts+1,format_repairs:state.format_repairs+(formatRepair?1:0)};
}
export function acceptClassification(state:ClassificationState,raw:unknown,text:string):{state:ClassificationState;result:Classification} {
  if(digest(text)!==state.source_snapshot_hash)throw new Error('classification_snapshot_changed');
  const result=parseModel<Classification>(ClassificationSchema,raw);const lines=text.split('\n');
  for(const evidence of result.evidence) {
    if(evidence.end_line<evidence.start_line||evidence.end_line>lines.length||!lines.slice(evidence.start_line-1,evidence.end_line).join('\n').includes(evidence.excerpt))throw new Error('classification_evidence_invalid');
  }
  if(result.content_eligibility!=='unresolved'&&!result.evidence.length)throw new Error('classification_evidence_required');
  if(result.content_eligibility==='excluded'&&!result.reason_codes.length)throw new Error('exclusion_reason_required');
  return {result,state:{...state,pending:false,credential:{candidate_id:state.candidate_id,source_snapshot_hash:state.source_snapshot_hash,semantic_policy_hash:state.semantic_policy_hash,
    content_eligibility:result.content_eligibility,evidence_hash:digest(JSON.stringify(result.evidence))}}};
}
export const classificationTools=new Set(['read_main','read_source','read_candidate','read_related_summary']);
export function requireClassificationTool(name:string):void {if(!classificationTools.has(name))throw new Error('classify_only_tool_denied');}

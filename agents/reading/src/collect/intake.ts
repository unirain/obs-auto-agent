import {digest,SubmissionSchema,parseModel,type ManualSubmission} from '../stages/contracts.js';
import {PolicyGate,matchedOrigins} from '../policy/gate.js';
import {addCandidate,discoverCandidate,normalizeUrl,type IdentityState} from './identity.js';
export type IntakePort={read():Promise<IdentityState>;commit(state:IdentityState,reason:string):Promise<void>};
export async function intakeManual(port:IntakePort,gate:PolicyGate,input:{submission_id:string;urls:string[];submitted_by:string;submitted_at:string;execution_scope:'production'}):Promise<ManualSubmission> {
  if(input.execution_scope!=='production'||!input.submission_id||!input.submitted_by)throw new Error('invalid_submission');
  const input_hash=digest(JSON.stringify(input.urls));const original=await port.read();const existing=original.submissions[input.submission_id];
  if(existing){parseModel<ManualSubmission>(SubmissionSchema,existing);if(existing.input_hash!==input_hash)throw new Error('submission_input_conflict');
    // Idempotent replay reports the current known project/PR status; never resets historical states.
    return {...existing,items:existing.items.map(item=>{const candidate=item.candidate_id?original.candidates[item.candidate_id]:undefined;return candidate?{...item,candidate_status:candidate.status,project_id:candidate.project_id,pr_number:candidate.pr_number}:item;})};}
  const next=structuredClone(original);const receipt:ManualSubmission={schema_version:1,submission_id:input.submission_id,execution_scope:'production',submitted_by:input.submitted_by,submitted_at:input.submitted_at,input_hash,items:[]};
  parseModel<ManualSubmission>(SubmissionSchema,receipt);for(const raw of input.urls){
    let url:string;try{url=normalizeUrl(raw);}catch{receipt.items.push({url:raw,status:'rejected',candidate_id:null,reason_codes:['invalid_url'],candidate_status:null,project_id:null,pr_number:null});continue;}
    const policy=await gate.current();const origins=['manual_url',...matchedOrigins(url,policy)];
    const check=await gate.check({subject_ref:`submission:${input.submission_id}:${digest(url)}`,execution_scope:'production',origin_source_ids:origins,urls:[url],main_url:url},'main_read','manual_intake');
    if(check.execution_permission!=='allowed'){receipt.items.push({url,status:'rejected',candidate_id:null,reason_codes:check.reason_codes,candidate_status:null,project_id:null,pr_number:null});continue;}
    const candidate=discoverCandidate('manual_url',url,null,null,input.submitted_at);candidate.origin_source_ids=origins;candidate.submission_refs=[input.submission_id];
    const merged=addCandidate(next,candidate);receipt.items.push({url,status:merged.created?'queued':'already_known',candidate_id:merged.candidate.candidate_id,reason_codes:[],candidate_status:merged.candidate.status,project_id:merged.candidate.project_id,pr_number:merged.candidate.pr_number});
  }
  parseModel<ManualSubmission>(SubmissionSchema,receipt);next.submissions[input.submission_id]=receipt;await port.commit(next,'manual_submission_and_candidates');return receipt;
}

import {canonicalJson} from '../contracts/index.js';
import {digest} from '../stages/contracts.js';
import {verifyContext,type ContextBundle} from './index.js';
export type OperatorGuidance={kind:'operator_input';fingerprint:string;guidance:string;actor:string;recovery_id:string;evidence_reference:string};
/** Only the most recent explicitly tagged, fixed generation input is an instruction; all ordinary version entries remain identifiers. */
export function fixedOperatorGuidance(context:ContextBundle):OperatorGuidance|null{
  verifyContext(context);let current:OperatorGuidance|null=null;for(const value of context.evidence_versions){let raw:unknown;try{raw=JSON.parse(value);}catch{continue;}if(!raw||typeof raw!=='object'||(raw as {kind?:unknown}).kind!=='operator_input')continue;const record=raw as Record<string,unknown>;if(Object.keys(record).some(key=>!['kind','fingerprint','guidance','actor','recovery_id','evidence_reference'].includes(key))||typeof record.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(record.fingerprint)||typeof record.guidance!=='string'||!record.guidance.trim()||record.guidance.length>8000||['actor','recovery_id','evidence_reference'].some(key=>typeof record[key]!=='string'||!(record[key] as string).trim()))throw new Error('fixed_operator_input_invalid');current=record as OperatorGuidance;}
  if(current){const fingerprint=digest(canonicalJson({guidance:current.guidance,skill_commit:context.skill_commit,skill_hash:context.skill_hash,runtime_versions:context.runtime_versions??null,runtime_limits:context.runtime_limits??null}));if(current.fingerprint!==fingerprint)throw new Error('fixed_operator_input_mismatch');}return current;
}
export function stagePromptContext(context:ContextBundle,writing:boolean):Record<string,unknown>{const visible={...context,evidence_versions:context.evidence_versions.map(value=>digest(value))};return writing?visible:Object.fromEntries(Object.entries(visible).filter(([key])=>key!=='example_texts'));}

import {canonicalJson} from '../contracts/index.js';
import {digest,type Evidence} from './contracts.js';
import {presentedCharacterCount,type ReadRange} from '../tools/segments.js';
import type {RuntimeProject} from './driver.js';
/** Coverage checks are pure metadata operations; never load historical bodies merely to calculate progress. */
export function hasRangeProgress(current:ReadRange[],previous:ReadRange[]):boolean{
  const full=(range:ReadRange,line:number)=>range.start_char===null&&range.start_line<=line&&range.end_line>=line;
  for(const next of current){const prior=previous.filter(old=>old.page===next.page);if(next.start_char===null){for(let line=next.start_line;line<=next.end_line;line++)if(!prior.some(old=>full(old,line)))return true;}
    else{if(prior.some(old=>full(old,next.start_line)))continue;const intervals=prior.filter(old=>old.start_line===next.start_line&&old.end_line===next.end_line&&old.start_char!==null).map(old=>[old.start_char!,old.end_char??0]).sort((a,b)=>a[0]!-b[0]!);let covered=next.start_char;for(const [start=0,end=0]of intervals){if(start>covered)break;covered=Math.max(covered,end);}if(covered<(next.end_char??0))return true;}}
  return false;
}
/** IDs and paraphrased claims do not make repeated source evidence a new fact. */
export function evidenceFingerprint(item:Evidence):string{return digest(canonicalJson({source_url:item.source_url,snapshot_hash:item.snapshot_hash,locator:item.locator,excerpt:item.excerpt.trim(),claim_type:item.claim_type}));}
export function hasResearchProgress(project:RuntimeProject,previous:RuntimeProject):boolean {
  const prior=new Set([...previous.partial_evidence,...(previous.research?.evidence??[])].map(evidenceFingerprint));const current=[...project.partial_evidence,...(project.research?.evidence??[])];
  if(current.some(item=>item.claim_type!=='agent_inference'&&!prior.has(evidenceFingerprint(item))))return true;
  const required=new Set(project.partial_questions.filter(question=>question.priority==='required').map(question=>question.id));for(const question of project.research?.questions??[])if(question.priority==='required')required.add(question.id);
  const answered=new Set(previous.research?.answers.filter(answer=>answer.source_not_provided||Boolean(answer.answer&&answer.evidence_ids.length)).map(answer=>answer.question_id)??[]);
  if(project.research?.answers.some(answer=>required.has(answer.question_id)&&!answered.has(answer.question_id)&&(answer.source_not_provided||Boolean(answer.answer&&answer.evidence_ids.length))))return true;
  const core=new Set([project.candidate.url,...(project.research?.source_versions.filter(source=>source.core||source.main).map(source=>source.url)??[])]);
  return project.snapshots.some(snapshot=>core.has(snapshot.url)||core.has(snapshot.requested_url??'')?(snapshot.body_reference&&snapshot.text===''?hasRangeProgress(project.read_ranges[snapshot.hash]??[],previous.read_ranges[snapshot.hash]??[]):presentedCharacterCount(snapshot,project.read_ranges[snapshot.hash]??[])>presentedCharacterCount(snapshot,previous.read_ranges[snapshot.hash]??[])):false);
}

import {canonicalJson} from '../contracts/index.js';
import {digest,type Evidence} from './contracts.js';
import {presentedCharacterCount} from '../tools/segments.js';
import type {RuntimeProject} from './driver.js';
/** IDs and paraphrased claims do not make repeated source evidence a new fact. */
export function evidenceFingerprint(item:Evidence):string{return digest(canonicalJson({source_url:item.source_url,snapshot_hash:item.snapshot_hash,locator:item.locator,excerpt:item.excerpt.trim(),claim_type:item.claim_type}));}
export function hasResearchProgress(project:RuntimeProject,previous:RuntimeProject):boolean {
  const prior=new Set([...previous.partial_evidence,...(previous.research?.evidence??[])].map(evidenceFingerprint));const current=[...project.partial_evidence,...(project.research?.evidence??[])];
  if(current.some(item=>item.claim_type!=='agent_inference'&&!prior.has(evidenceFingerprint(item))))return true;
  const required=new Set(project.partial_questions.filter(question=>question.priority==='required').map(question=>question.id));for(const question of project.research?.questions??[])if(question.priority==='required')required.add(question.id);
  const answered=new Set(previous.research?.answers.filter(answer=>answer.source_not_provided||Boolean(answer.answer&&answer.evidence_ids.length)).map(answer=>answer.question_id)??[]);
  if(project.research?.answers.some(answer=>required.has(answer.question_id)&&!answered.has(answer.question_id)&&(answer.source_not_provided||Boolean(answer.answer&&answer.evidence_ids.length))))return true;
  const core=new Set([project.candidate.url,...(project.research?.source_versions.filter(source=>source.core||source.main).map(source=>source.url)??[])]);
  return project.snapshots.some(snapshot=>core.has(snapshot.url)||core.has(snapshot.requested_url??'')?presentedCharacterCount(snapshot,project.read_ranges[snapshot.hash]??[])>presentedCharacterCount(snapshot,previous.read_ranges[snapshot.hash]??[]):false);
}

import {assertUtcInstant} from '../contracts/utc.js';
import {MaterialBodyCache,type SnapshotBodyReader,type BodyCacheLimits} from './bodies.js';
import {digest,EvidenceSchema,ResearchSchema,parseModel,type Evidence,type ResearchPacket} from '../stages/contracts.js';
export type SnapshotBodyReference={schema_version:1;path:string;sha256:string;bytes:number};
export type MaterialSnapshot={url:string;text:string;body_reference?:SnapshotBodyReference;body_metadata?:{line_count:number;page_count:number|null};hash:string;retrieved_at:string;links:string[];link_locators?:{url:string;page:number|null}[];kind:'web'|'pdf'|'code';capture_method?:'http'|'browser';pages?:string[];commit?:string;file?:string;requested_url?:string;figures?:{url:string;caption:string}[];canonical_url?:string|null;title?:string};
export class EvidenceRegistry {
  private snapshots=new Map<string,MaterialSnapshot[]>();
  readonly bodies:MaterialBodyCache;
  constructor(initial:MaterialSnapshot[]=[],reader?:SnapshotBodyReader,project_id?:string,limits?:Partial<BodyCacheLimits>) {this.bodies=new MaterialBodyCache(reader,project_id,limits);for(const material of initial)this.register(material);}
  register(snapshot:MaterialSnapshot):void {assertUtcInstant(snapshot.retrieved_at,'material retrieved_at');if(!snapshot.body_reference&&digest(snapshot.text)!==snapshot.hash)throw new Error('snapshot_hash_invalid');const prior=this.snapshots.get(snapshot.hash)??[];if(!prior.some(item=>item.url===snapshot.url&&item.retrieved_at===snapshot.retrieved_at))prior.push(snapshot);this.snapshots.set(snapshot.hash,prior);}
  get(hash:string,source_url?:string,retrieved_at?:string):MaterialSnapshot {const matches=(this.snapshots.get(hash)??[]).filter(item=>(source_url===undefined||item.url===source_url||item.requested_url===source_url)&&(retrieved_at===undefined||item.retrieved_at===retrieved_at));if(!matches.length)throw new Error('snapshot_missing');if(matches.length>1)throw new Error('snapshot_identity_ambiguous');return matches[0]!;}
  follow(from_hash:string,url:string):void {if(!(this.snapshots.get(from_hash)??[]).some(snapshot=>snapshot.links.includes(url)))throw new Error('reference_not_in_material');}
  withSnapshot<T>(snapshot:MaterialSnapshot,consume:(material:MaterialSnapshot)=>T|Promise<T>):Promise<T>{return this.bodies.withSnapshot(snapshot,consume);}
  async validateAsync(raw:unknown,prior:Evidence[]):Promise<Evidence>{const evidence=parseModel<Evidence>(EvidenceSchema,raw);return this.withSnapshot(this.get(evidence.snapshot_hash,evidence.source_url,evidence.retrieved_at),snapshot=>this.validateAgainst(evidence,prior,snapshot));}
  validate(raw:unknown,prior:Evidence[]):Evidence {const evidence=parseModel<Evidence>(EvidenceSchema,raw);const snapshot=this.get(evidence.snapshot_hash,evidence.source_url,evidence.retrieved_at);if(snapshot.body_reference&&snapshot.text==='')throw new Error('material_body_not_hydrated');return this.validateAgainst(evidence,prior,snapshot);}
  private validateAgainst(evidence:Evidence,prior:Evidence[],snapshot:MaterialSnapshot):Evidence {
    if(snapshot.url!==evidence.source_url||snapshot.retrieved_at!==evidence.retrieved_at)throw new Error('evidence_source_mismatch');
    let text=snapshot.text;
    if(snapshot.kind==='pdf'){if(!evidence.locator.page||!snapshot.pages?.[evidence.locator.page-1])throw new Error('pdf_page_invalid');text=snapshot.pages[evidence.locator.page-1]!;}
    if(snapshot.kind==='code'&&(evidence.locator.commit!==snapshot.commit||evidence.locator.file!==snapshot.file||evidence.claim_type!=='code_observation'))throw new Error('code_locator_invalid');
    if(snapshot.kind!=='code'&&evidence.claim_type==='code_observation')throw new Error('code_observation_without_code');
    const lines=text.split('\n');if(evidence.locator.end_line<evidence.locator.start_line||evidence.locator.end_line>lines.length||!lines.slice(evidence.locator.start_line-1,evidence.locator.end_line).join('\n').includes(evidence.excerpt))throw new Error('excerpt_not_locatable');
    if(evidence.claim_type==='agent_inference'&&(!evidence.based_on.length||evidence.based_on.some(id=>!prior.some(item=>item.evidence_id===id))))throw new Error('inference_support_missing');
    if(evidence.claim_type!=='agent_inference'&&evidence.based_on.length)throw new Error('unexpected_inference_dependencies');return evidence;
  }
  validatePartialResearch(raw:unknown):ResearchPacket {
    const packet=parseModel<ResearchPacket>(ResearchSchema,raw);const validated:Evidence[]=[];
    for(const evidence of packet.evidence){if(validated.some(item=>item.evidence_id===evidence.evidence_id))throw new Error('duplicate_evidence');validated.push(this.validate(evidence,validated));}
    return this.validatePacketReferences(packet,validated);
  }
  async validatePartialResearchAsync(raw:unknown):Promise<ResearchPacket>{const packet=parseModel<ResearchPacket>(ResearchSchema,raw);const validated:Evidence[]=[];for(const evidence of packet.evidence){if(validated.some(item=>item.evidence_id===evidence.evidence_id))throw new Error('duplicate_evidence');validated.push(await this.validateAsync(evidence,validated));}return this.validatePacketReferences(packet,validated);}
  private validatePacketReferences(packet:ResearchPacket,validated:Evidence[]):ResearchPacket{
    const ids=new Set(validated.map(item=>item.evidence_id));
    if(new Set(packet.questions.map(question=>question.id)).size!==packet.questions.length)throw new Error('duplicate_question');
    for(const answer of packet.answers)if(!packet.questions.some(question=>question.id===answer.question_id)||answer.evidence_ids.some(id=>!ids.has(id)))throw new Error('answer_evidence_invalid');
    for(const source of packet.source_versions.filter(source=>source.status==='read'))if(!([this.get(source.hash,source.url).url,this.get(source.hash,source.url).requested_url].includes(source.url)))throw new Error('source_version_mismatch');
    const knownUrls=new Set([...this.snapshots.values()].flat().flatMap(snapshot=>[snapshot.url,...(snapshot.requested_url?[snapshot.requested_url]:[]),...snapshot.links]));
    if(packet.source_versions.some(source=>!knownUrls.has(source.url))||packet.gaps.some(gap=>!knownUrls.has(gap.url)))throw new Error('research_material_not_registered');
    return packet;
  }
  validateResearch(raw:unknown):ResearchPacket {
    return this.validateCompleteness(this.validatePartialResearch(raw));
  }
  async validateResearchAsync(raw:unknown):Promise<ResearchPacket>{return this.validateCompleteness(await this.validatePartialResearchAsync(raw));}
  private validateCompleteness(packet:ResearchPacket):ResearchPacket{const ids=new Set(packet.evidence.map(item=>item.evidence_id));
    if(!packet.source_versions.some(source=>source.main&&source.status==='read'))throw new Error('main_source_unread');
    if(packet.source_versions.some(source=>source.core&&source.status!=='read')||packet.gaps.some(gap=>gap.core))throw new Error('core_material_gap');
    for(const question of packet.questions.filter(question=>question.priority==='required')) {
      const answers=packet.answers.filter(answer=>answer.question_id===question.id);if(answers.length!==1)throw new Error('required_answer_missing');const answer=answers[0]!;
      if(answer.source_not_provided){if(answer.answer!==null||answer.evidence_ids.length)throw new Error('source_not_provided_became_claim');}
      else if(!answer.answer||!answer.evidence_ids.length)throw new Error('answer_not_supported');
    }
    if(!packet.mechanism_evidence_ids.length||!packet.boundary_evidence_ids.length||[...packet.mechanism_evidence_ids,...packet.boundary_evidence_ids].some(id=>!ids.has(id)))throw new Error('mechanism_or_boundary_unverified');
    return packet;
  }
}
export async function reverifyCore(packet:ResearchPacket,read:(url:string)=>Promise<{hash:string}>,now:Date,mode:string,classificationCurrent:boolean):Promise<{sources_verified_at:string;source_hashes:Record<string,string>}> {
  if(!classificationCurrent)throw new Error(mode==='publish-only'?'resume_required':'classification_required');const source_hashes:Record<string,string>={};
  for(const source of packet.source_versions.filter(item=>item.core||item.main)){const fresh=await read(source.url);if(fresh.hash!==source.hash)throw new Error(mode==='publish-only'?'resume_required':'core_source_changed');source_hashes[source.url]=fresh.hash;}
  return {sources_verified_at:now.toISOString(),source_hashes};
}

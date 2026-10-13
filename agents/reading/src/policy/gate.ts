import {canonicalJson} from '../contracts/index.js';
import {parsePolicyCheck} from './records.js';
export {PolicyCheckSchema,parsePolicyCheck} from './records.js';
import { digest, type Capability, type Scope } from '../stages/contracts.js';

export type TrustedPolicy = {
  commit:string;hash:string;semantic_policy_hash:string; paused:boolean; paused_projects:string[];
  sources:Record<string,{enabled:boolean;domains:string[]}>;manual_url:{enabled:boolean};
  denied_domains:string[];allowed_domains:string[];excluded_topics:string[];excluded_content_types?:string[];
};
export type ClassificationCredential = {candidate_id:string;source_snapshot_hash:string;semantic_policy_hash:string;content_eligibility:'allowed'|'excluded'|'unresolved';evidence_hash:string};
export type PolicySubject = {subject_ref:string;candidate_id?:string;project_id?:string;execution_scope:Scope;
  origin_source_ids:string[];urls:string[];original_domains?:string[];manual_resource_of?:string;main_url?:string;source_snapshot_hash?:string;classification?:ClassificationCredential};
export type PolicyCheck = {schema_version:1;subject_ref:string;execution_scope:Scope;checkpoint:string;requested_capability:Capability;
  policy_commit:string|null;policy_hash:string|null;semantic_policy_hash:string|null;checked_at:string;
  execution_permission:'allowed'|'denied'|'unavailable';content_eligibility:'allowed'|'excluded'|'unresolved';reason_codes:string[];check_id:string};
export function domainMatches(host:string,rule:string):boolean {return host===rule || (rule.startsWith('*.') && host.endsWith(rule.slice(1)) && host!==rule.slice(2));}
export function matchedOrigins(url:string,policy:TrustedPolicy):string[] {
  const host=new URL(url).hostname.toLowerCase();return Object.entries(policy.sources).filter(([,source])=>source.domains.some(domain=>domainMatches(host,domain))).map(([id])=>id);
}
export function credentialValid(subject:PolicySubject,policy:TrustedPolicy):boolean {
  return subject.classification!==undefined && subject.classification.candidate_id===subject.candidate_id &&
    subject.classification.source_snapshot_hash===subject.source_snapshot_hash && subject.classification.semantic_policy_hash===policy.semantic_policy_hash;
}
export class PolicyGate {
  constructor(private readonly load:()=>Promise<TrustedPolicy>,private readonly persist:(check:PolicyCheck)=>Promise<void>,private readonly now:()=>Date=()=>new Date()){}
  async current():Promise<TrustedPolicy>{return this.load();}
  async check(subject:PolicySubject,capability:Capability,checkpoint:string):Promise<PolicyCheck> {
    const result:Omit<PolicyCheck,'check_id'>={schema_version:1,subject_ref:subject.subject_ref,execution_scope:subject.execution_scope,checkpoint,requested_capability:capability,
      policy_commit:null,policy_hash:null,semantic_policy_hash:null,checked_at:this.now().toISOString(),execution_permission:'allowed',content_eligibility:'unresolved',reason_codes:[]};
    try {
      const policy=await this.load();result.policy_commit=policy.commit;result.policy_hash=policy.hash;result.semantic_policy_hash=policy.semantic_policy_hash;
      if(!/^[a-f0-9]{40}$/.test(policy.commit)||![policy.hash,policy.semantic_policy_hash].every(value=>/^[a-f0-9]{64}$/.test(value))) throw new Error('invalid_trusted_policy');
      // Reconciliation is read-only and records facts even after permissions are revoked.
      if(capability!=='reconcile') {
        if(policy.paused) result.reason_codes.push('global_paused');
        if(subject.project_id&&policy.paused_projects.includes(subject.project_id)) result.reason_codes.push('project_paused');
        const origins=new Set(subject.origin_source_ids);
        for(const url of subject.urls) for(const id of matchedOrigins(url,policy)) origins.add(id);
        for(const id of origins) {
          if(id==='manual_url'){if(!policy.manual_url.enabled)result.reason_codes.push('manual_disabled');}
          else if(!policy.sources[id]?.enabled)result.reason_codes.push(`source_disabled:${id}`);
        }
        for(const raw of subject.urls) {
          const url=new URL(raw);const host=url.hostname.toLowerCase();
          if(!['https:','http:'].includes(url.protocol)||url.username||url.password)result.reason_codes.push('invalid_url');
          if(policy.denied_domains.some(rule=>domainMatches(host,rule)))result.reason_codes.push(`domain_denied:${host}`);
          const manualMain=origins.has('manual_url')&&subject.main_url===raw;
          const manualResource=capability==='main_read'&&origins.has('manual_url')&&subject.main_url!==undefined&&subject.manual_resource_of===subject.main_url&&url.origin===new URL(subject.main_url).origin;
          if(!manualMain&&!manualResource&&!policy.allowed_domains.some(rule=>domainMatches(host,rule)))result.reason_codes.push(`domain_outside_scope:${host}`);if(!manualMain&&!manualResource&&subject.original_domains&&!subject.original_domains.some(rule=>domainMatches(host,rule)))result.reason_codes.push(`domain_outside_original_scope:${host}`);
        }
        if(subject.execution_scope==='preview'&&['upload','publish','cleanup'].includes(capability))result.reason_codes.push('preview_no_write');
        result.content_eligibility=credentialValid(subject,policy)?subject.classification!.content_eligibility:'unresolved';
        if(!['discover','main_read','classify_only','cleanup'].includes(capability) && result.content_eligibility!=='allowed')result.reason_codes.push(result.content_eligibility==='excluded'?'semantic_excluded':'classification_required');
        if(result.reason_codes.length)result.execution_permission='denied';
      }
    } catch {result.execution_permission='unavailable';result.reason_codes=['policy_unavailable'];result.policy_commit=null;result.policy_hash=null;result.semantic_policy_hash=null;}
    const check=parsePolicyCheck({...result,check_id:digest(canonicalJson(result))});
    await this.persist(check); // A permission that did not commit cannot authorize an effect.
    return check;
  }
  async require(subject:PolicySubject,capability:Capability,checkpoint:string):Promise<PolicyCheck>{
    const check=parsePolicyCheck(await this.check(subject,capability,checkpoint));if(check.subject_ref!==subject.subject_ref||check.execution_scope!==subject.execution_scope||check.requested_capability!==capability||check.checkpoint!==checkpoint)throw new Error('policy_check_subject_binding_mismatch');if(check.execution_permission!=='allowed')throw new Error(check.reason_codes.join(','));return check;
  }
}

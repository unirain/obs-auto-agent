import {digest,CandidateSchema,parseModel,type Candidate} from '../stages/contracts.js';
const tracking=new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','mc_cid','mc_eid']);
export function normalizeUrl(raw:string):string {
  const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('invalid_public_url');
  url.hash='';for(const key of [...url.searchParams.keys()])if(tracking.has(key))url.searchParams.delete(key);
  url.searchParams.sort();return url.href;
}
export type IdentityState={schema_version:1;candidates:Record<string,Candidate>;aliases:Record<string,string>;content:Record<string,string>;submissions:Record<string,import('../stages/contracts.js').ManualSubmission>};
export const emptyIdentity=():IdentityState=>({schema_version:1,candidates:{},aliases:{},content:{},submissions:{}});
export function addCandidate(state:IdentityState,candidate:Candidate):{candidate:Candidate;created:boolean} {
  parseModel<Candidate>(CandidateSchema,candidate);const urls=[candidate.url,...candidate.aliases,...(candidate.canonical_url?[candidate.canonical_url]:[])].map(normalizeUrl);
  const found=urls.map(url=>state.aliases[url]).find(Boolean)??(candidate.content_hash?state.content[candidate.content_hash]:undefined);
  if(found){const existing=state.candidates[found];if(!existing)throw new Error('identity_index_corrupt');
    existing.origin_source_ids=[...new Set([...existing.origin_source_ids,...candidate.origin_source_ids])];existing.aliases=[...new Set([...existing.aliases,...urls])];
    existing.submission_refs=[...new Set([...existing.submission_refs,...candidate.submission_refs])];
    for(const url of urls)state.aliases[url]=found;return {candidate:existing,created:false};}
  state.candidates[candidate.candidate_id]=candidate;for(const url of urls)state.aliases[url]=candidate.candidate_id;
  if(candidate.content_hash)state.content[candidate.content_hash]=candidate.candidate_id;return {candidate,created:true};
}
export function discoverCandidate(source_id:string,url:string,title:string|null,published_at:string|null,now:string):Candidate {
  const normalized=normalizeUrl(url);return parseModel<Candidate>(CandidateSchema,{schema_version:1,candidate_id:`candidate_${digest(normalized)}`,source_id,source_item_id:digest(normalized),origin_source_ids:[source_id],
    url:normalized,canonical_url:null,aliases:[normalized],title,discovered_at:now,published_at,submission_refs:[],content_hash:null,status:'discovered',project_id:null,pr_number:null});
}
/** Canonical links must be present in a fetched document, permitted by policy, and verified by a read of the target. */
export function bindFetchedIdentity(state:IdentityState,candidate_id:string,input:{final_url:string;body_hash:string;canonical_url?:string;verified_canonical_hash?:string;origins:string[]}):Candidate {
  const candidate=state.candidates[candidate_id];if(!candidate)throw new Error('candidate_not_found');
  if(input.canonical_url&&input.verified_canonical_hash!==input.body_hash)throw new Error('canonical_unverified');
  const aliases=[normalizeUrl(input.final_url),...(input.canonical_url?[normalizeUrl(input.canonical_url)]:[])];
  const match=aliases.map(url=>state.aliases[url]).find(id=>id&&id!==candidate_id)??state.content[input.body_hash];
  if(!/^[a-f0-9]{64}$/.test(input.body_hash))throw new Error('body_hash_invalid');candidate.content_hash=input.body_hash;candidate.canonical_url=input.canonical_url?normalizeUrl(input.canonical_url):normalizeUrl(input.final_url);
  candidate.origin_source_ids=[...new Set([...candidate.origin_source_ids,...input.origins])];candidate.aliases=[...new Set([...candidate.aliases,...aliases])];
  if(match&&match!==candidate_id) {
    const survivor=state.candidates[match];if(!survivor)throw new Error('identity_index_corrupt');
    if(candidate.project_id&&survivor.project_id&&candidate.project_id!==survivor.project_id)throw new Error('identity_project_conflict_requires_reconciliation');
    survivor.origin_source_ids=[...new Set([...survivor.origin_source_ids,...candidate.origin_source_ids])];survivor.aliases=[...new Set([...survivor.aliases,...candidate.aliases])];
    survivor.submission_refs=[...new Set([...survivor.submission_refs,...candidate.submission_refs])];
    for(const url of survivor.aliases)state.aliases[url]=match;candidate.status=`merged_identity:${match}`;state.content[input.body_hash]=match;return survivor;
  }
  for(const url of candidate.aliases)state.aliases[url]=candidate_id;state.content[input.body_hash]=candidate_id;return candidate;
}

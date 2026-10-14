import {assertUtcInstant} from '../contracts/utc.js';
import { parse as parseYaml } from 'yaml';
import {canonicalJson} from '../contracts/index.js';
import {normalizeUrl} from '../collect/identity.js';
import type {RuntimeVersions} from '../runtime/versions.js';
import {resolveRuntimeLimits,type RuntimeLimits} from '../runtime/limits.js';
export type {RuntimeLimits} from '../runtime/limits.js';
import {digest} from '../stages/contracts.js';
export type NoteInput={path:string;commit:string;text:string;first_added_at:string;pending?:boolean};
export type NoteIndex={id:string;path:string;commit:string;title:string;tags:string[];sources:string[];summary:string;organized_at:string;date_basis:string;hash:string;pending:boolean;text:string};
export function heldoutNote(note:Pick<NoteIndex,'path'|'sources'>,heldout:{urls:Set<string>;note_paths:Set<string>}):boolean{return heldout.note_paths.has(note.path)||note.sources.some(url=>{try{return heldout.urls.has(normalizeUrl(url));}catch{return heldout.urls.has(url);}});}
function validDate(raw:unknown):string|null {
  if(raw instanceof Date)return raw.toISOString();if(typeof raw!=='string')return null;
  if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw))return null;const value=Date.parse(raw);if(!Number.isFinite(value))return null;
  if(new Date(value).toISOString().slice(0,10)!==raw.slice(0,10))return null;return new Date(value).toISOString();
}
export function indexNote(input:NoteInput):NoteIndex {
  if(!input.path.startsWith('Organize Notes By AI/')||!input.path.endsWith('.md'))throw new Error('note_index_path');
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(input.text);const metadata:Record<string,unknown>=match?(parseYaml(match[1]!) as Record<string,unknown>)??{}:{};
  let organized_at:string|null=null;let date_basis='first_added_git';
  for(const key of ['reviewed_at','updated','created']){organized_at=validDate(metadata[key]);if(organized_at){date_basis=key;break;}}
  if(!organized_at){const name=/(?:^|\/)(\d{2})(\d{2})(\d{2})-/.exec(input.path);if(name){organized_at=validDate(`20${name[1]}-${name[2]}-${name[3]}`);if(organized_at)date_basis='filename_YYMMDD';}}
  organized_at??=validDate(input.first_added_at);if(!organized_at)throw new Error('organized_date_unavailable');
  const body=input.text.slice(match?.[0].length??0);const title=typeof metadata.title==='string'?metadata.title:body.match(/^#\s+(.+)$/m)?.[1]??input.path;
  const tags=Array.isArray(metadata.tags)?metadata.tags.filter((value):value is string=>typeof value==='string'):[];
  const source=typeof metadata.source==='string'?[metadata.source]:[];const linked=[...body.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map(value=>value[1]!);
  return {id:digest(`${input.commit}:${input.path}`),path:input.path,commit:input.commit,title,tags,sources:[...new Set([...source,...linked])],summary:body.replace(/```[\s\S]*?```/g,'').replace(/[#>*]/g,'').trim().slice(0,600),
    organized_at,date_basis,hash:digest(input.text),pending:input.pending??false,text:input.text};
}
function tokens(text:string):Set<string>{return new Set((text.toLowerCase().match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g)??[]));}
export function recallNotes(index:NoteIndex[],query:string,heldout:{urls:Set<string>;note_paths:Set<string>},limit=12):NoteIndex[]{
  const terms=tokens(query);const ranked=index.filter(note=>!heldoutNote(note,heldout))
    .map(note=>({note,score:[...tokens(`${note.title} ${note.tags.join(' ')} ${note.summary}`)].filter(term=>terms.has(term)).length}));
  return ranked.filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.note.organized_at.localeCompare(a.note.organized_at)||a.note.path.localeCompare(b.note.path)).slice(0,limit).map(item=>item.note);
}
export type ContextBundle={context_id:string;preferences_hash:string;skill_commit:string;skill_hash:string;prompt_hash:string;prompt_templates?:Record<string,string>;runtime_limits?:RuntimeLimits;runtime_versions?:RuntimeVersions;tool_domains?:string[];model:string;model_provider?:'claude'|'deepseek';model_base_url?:string;evidence_versions:string[];examples:Omit<NoteIndex,'text'>[];related_notes:(Omit<NoteIndex,'text'>&{retrieval_relevance?:'matched'|'unknown'})[];example_texts:Record<string,string>};
export function buildContext(input:{index:NoteIndex[];query:string;heldout:{urls:Set<string>;note_paths:Set<string>};preferences_hash:string;skill_commit:string;skill_hash:string;prompt_hash:string;prompt_templates?:Record<string,string>;runtime_limits?:RuntimeLimits;runtime_versions?:RuntimeVersions;tool_domains?:string[];model:string;model_provider?:'claude'|'deepseek';model_base_url?:string;evidence_versions:string[];example_count?:number}):ContextBundle {
  const related=recallNotes(input.index,input.query,input.heldout);const count=input.example_count??3;if(!Number.isSafeInteger(count)||count<1)throw new Error('example_count_invalid');const relevant=related.filter(note=>!note.pending);const fallback=input.index.filter(note=>!note.pending&&!heldoutNote(note,input.heldout)).sort((a,b)=>b.organized_at.localeCompare(a.organized_at)||a.path.localeCompare(b.path));const selected=new Map([...relevant,...fallback].map(note=>[note.path,note]));const examples=[...selected.values()].slice(0,count);
  const metadata=(note:NoteIndex):Omit<NoteIndex,'text'>=>{const {text:_,...rest}=note;return rest;};
  const content={preferences_hash:input.preferences_hash,skill_commit:input.skill_commit,skill_hash:input.skill_hash,prompt_hash:input.prompt_hash,...(input.prompt_templates?{prompt_templates:input.prompt_templates}:{}),...(input.runtime_limits?{runtime_limits:resolveRuntimeLimits(input.runtime_limits)}:{}),...(input.runtime_versions?{runtime_versions:input.runtime_versions}:{}),...(input.tool_domains?{tool_domains:input.tool_domains}:{}),model:input.model,...(input.model_provider?{model_provider:input.model_provider}:{}),...(input.model_base_url?{model_base_url:input.model_base_url}:{}),
    evidence_versions:input.evidence_versions,examples:examples.map(metadata),related_notes:(related.length?related.map(note=>({...metadata(note),retrieval_relevance:'matched' as const})):examples.map(note=>({...metadata(note),retrieval_relevance:'unknown' as const}))),example_texts:Object.fromEntries(examples.map(note=>[note.path,note.text]))};
  return {context_id:digest(canonicalJson(content)),...content};
}
export function verifyContext(bundle:ContextBundle,expectedProvider?:{model_provider:'claude'|'deepseek';model_base_url:string}):void {const {context_id,...rest}=bundle;if(digest(canonicalJson(rest))!==context_id)throw new Error('context_hash_mismatch');
  if(expectedProvider&&(!bundle.model_provider||!bundle.model_base_url||bundle.model_provider!==expectedProvider.model_provider||bundle.model_base_url!==expectedProvider.model_base_url))throw new Error('fixed_provider_unavailable');
  if(bundle.model_base_url){const url=new URL(bundle.model_base_url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('model_base_url_unsafe');}
  if(bundle.runtime_limits)resolveRuntimeLimits(bundle.runtime_limits);if(bundle.runtime_versions){const versions=bundle.runtime_versions;if(!/^\d+\.\d+\.\d+$/.test(versions.sdk_version)||!/^v\d+\.\d+\.\d+$/.test(versions.node_version)||!/^sha256:[a-f0-9]{64}$/.test(versions.tools_image_id)||![versions.sdk_hash,versions.tools_manifest_hash].every(hash=>/^[a-f0-9]{64}$/.test(hash))||!['requested_alias','provider_reported_unpinned'].includes(versions.model_version_status))throw new Error('fixed_runtime_versions_invalid');}
  if(bundle.prompt_templates){const stages=bundle.prompt_templates.agent?['agent','selection','research','writing','review']:['selection','research','writing','review'];const bytes=stages.map(stage=>{const text=bundle.prompt_templates![stage];if(!text)throw new Error('fixed_prompt_template_unavailable');return Buffer.from(text);});if(digest(Buffer.concat(bytes))!==bundle.prompt_hash)throw new Error('fixed_prompt_hash_mismatch');}
  for(const note of [...bundle.examples,...bundle.related_notes])assertUtcInstant(note.organized_at,'note organized_at');
  for(const note of bundle.examples)if(digest(bundle.example_texts[note.path]??'')!==note.hash)throw new Error('example_hash_mismatch');}

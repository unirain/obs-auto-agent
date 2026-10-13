import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { Octokit } from '@octokit/rest';
import type { TrustedPolicy } from '../policy/gate.js';

const exec = promisify(execFile);
const paths = ['preferences.yaml','sources.yaml','runtime.yaml'] as const;
export type PolicySnapshot = { commit: string; files: Record<(typeof paths)[number],string> };
export interface PolicySource { readSnapshot(): Promise<PolicySnapshot> }
const hash = (v:unknown):string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export class GitPolicySource implements PolicySource {
  constructor(private readonly repository:string,private readonly ref?:string) {
    if(ref&&!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref))throw new Error('untrusted_policy_ref');
  }
  async readSnapshot():Promise<PolicySnapshot> {
    let ref=this.ref;
    if(!ref){
      try{const head=(await exec('git',['-C',this.repository,'symbolic-ref','refs/remotes/origin/HEAD'])).stdout.trim();ref='refs/heads/'+head.replace(/^refs\/remotes\/origin\//,'');}
      catch{ref=(await exec('git',['-C',this.repository,'symbolic-ref','HEAD'])).stdout.trim();}
    }
    if(!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref))throw new Error('untrusted_policy_ref');
    const {stdout} = await exec('git',['-C',this.repository,'rev-parse','--verify',`${ref}^{commit}`]);
    const commit=stdout.trim();
    if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('invalid_policy_commit');
    const files = {} as PolicySnapshot['files'];
    for(const path of paths) files[path]=(await exec('git',['-C',this.repository,'show',`${commit}:agents/reading/${path}`],{maxBuffer:2_000_000})).stdout;
    return {commit,files};
  }
}

/** Resolve the latest trusted default-branch ref before each policy check. */
export class GitHubPolicySource implements PolicySource {
  constructor(private readonly client:Octokit,private readonly owner:string,private readonly repo:string,private readonly branch?:string) {}
  async readSnapshot():Promise<PolicySnapshot> {
    const repository=(await this.client.rest.repos.get({owner:this.owner,repo:this.repo})).data;
    if(this.branch&&this.branch!==repository.default_branch)throw new Error('policy_ref_not_default_branch');
    const {data}=await this.client.rest.repos.getCommit({owner:this.owner,repo:this.repo,ref:repository.default_branch});
    const commit=data.sha;
    const files={} as PolicySnapshot['files'];
    for(const path of paths) {
      const result=await this.client.rest.repos.getContent({owner:this.owner,repo:this.repo,path:`agents/reading/${path}`,ref:commit});
      if(Array.isArray(result.data)||!('content' in result.data)||result.data.type!=='file')throw new Error('policy_file_missing');
      files[path]=Buffer.from(result.data.content,'base64').toString('utf8');
    }
    return {commit,files};
  }
}

function object(value:unknown,label:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`invalid_${label}`);
  return value as Record<string,unknown>;
}
function strings(value:unknown,label:string):string[] {
  if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw new Error(`invalid_${label}`);
  return value as string[];
}
export function parseTrustedPolicy(snapshot:PolicySnapshot):TrustedPolicy {
  if(!/^[a-f0-9]{40}$/.test(snapshot.commit))throw new Error('invalid_policy_commit');
  const preferences=object(parse(snapshot.files['preferences.yaml']),'preferences');
  const sources=object(parse(snapshot.files['sources.yaml']),'sources');
  const runtime=object(parse(snapshot.files['runtime.yaml']),'runtime');
  for(const value of [preferences,sources,runtime])if(value.schema_version!==1)throw new Error('unknown_policy_schema');
  if(runtime.cost_policy!=='observe_only'||runtime.storage_limit_bytes!==50_000_000_000)throw new Error('intent_resource_boundary_changed');
  if(typeof runtime.paused!=='boolean')throw new Error('invalid_global_pause');
  const entries=object(sources.sources,'source_entries');
  const configured:TrustedPolicy['sources']={};
  for(const [id,entry] of Object.entries(entries)) {
    const record=object(entry,'source');
    if(typeof record.enabled!=='boolean')throw new Error('invalid_source_enabled');
    configured[id]={enabled:record.enabled,domains:strings(record.domains,'source_domains')};
  }
  const manual=object(sources.manual_url,'manual_url');
  if(typeof manual.enabled!=='boolean')throw new Error('invalid_manual_enabled');
  const excluded_topics=[...new Set(strings(preferences.excluded_topics,'excluded_topics'))].sort();
  const excluded_content_types=[...new Set(strings(preferences.excluded_content_types,'excluded_content_types'))].sort();
  const result={commit:snapshot.commit,hash:hash(snapshot.files),semantic_policy_hash:hash({excluded_topics,excluded_content_types}),
    paused:runtime.paused,paused_projects:strings(runtime.paused_projects,'paused_projects'),sources:configured,manual_url:{enabled:manual.enabled},
    denied_domains:strings(runtime.denied_domains,'denied_domains'),allowed_domains:strings(runtime.allowed_domains,'allowed_domains'),excluded_topics,excluded_content_types};
  return result;
}
export const trustedPolicyLoader=(source:PolicySource):(()=>Promise<TrustedPolicy>)=>async()=>parseTrustedPolicy(await source.readSnapshot());

import {observedHttpLinks,type UrlGateway,type GatewayDownloadBudget} from './fetch.js';
import {digest} from '../stages/contracts.js';
import {safeRelative} from './files.js';
import type {MaterialSnapshot} from './evidence.js';
export async function readRepositoryFile(gateway:UrlGateway,input:{owner:string;repository:string;commit:string;file:string},deadline:number,download?:GatewayDownloadBudget):Promise<MaterialSnapshot>{
  if(!/^[a-zA-Z0-9_.-]+$/.test(input.owner)||!/^[a-zA-Z0-9_.-]+$/.test(input.repository)||!/^[a-f0-9]{40}$/.test(input.commit))throw new Error('repository_identity_not_fixed');safeRelative(input.file);
  const url=`https://raw.githubusercontent.com/${input.owner}/${input.repository}/${input.commit}/${input.file.split('/').map(encodeURIComponent).join('/')}`;
  const result=await gateway.read(url,{mime:['text/plain','application/octet-stream'],deadline,download});const text=new TextDecoder().decode(result.bytes);
  return {url,text,hash:digest(text),retrieved_at:new Date().toISOString(),links:observedHttpLinks(text),kind:'code',commit:input.commit,file:input.file};
}
export async function resolveLinkedRepository(gateway:UrlGateway,registeredUrl:string,deadline:number,download?:GatewayDownloadBudget):Promise<{owner:string;repository:string;commit:string}>{
  const url=new URL(registeredUrl);if(url.hostname!=='github.com')throw new Error('repository_host_denied');const parts=url.pathname.split('/').filter(Boolean);const [owner,repository]=parts;
  if(!owner||!repository||!/^[a-zA-Z0-9_.-]+$/.test(owner)||!/^[a-zA-Z0-9_.-]+$/.test(repository))throw new Error('repository_identity_invalid');
  if(['tree','blob'].includes(parts[2]??'')&&/^[a-f0-9]{40}$/.test(parts[3]??''))return {owner,repository,commit:parts[3]!};
  const ref=['tree','blob'].includes(parts[2]??'')?parts[3]:'HEAD';if(!ref)throw new Error('repository_ref_invalid');
  const response=await gateway.read(`https://api.github.com/repos/${owner}/${repository}/commits/${encodeURIComponent(ref)}`,{mime:['application/json'],deadline,download});const value=JSON.parse(new TextDecoder().decode(response.bytes)) as {sha?:unknown};
  if(typeof value.sha!=='string'||!/^[a-f0-9]{40}$/.test(value.sha))throw new Error('repository_commit_not_verified');return {owner,repository,commit:value.sha};
}
export async function listRepositoryFiles(gateway:UrlGateway,input:{owner:string;repository:string;commit:string},deadline:number,download?:GatewayDownloadBudget):Promise<string[]>{
  const response=await gateway.read(`https://api.github.com/repos/${input.owner}/${input.repository}/git/trees/${input.commit}?recursive=1`,{mime:['application/json'],deadline,download});const data=JSON.parse(new TextDecoder().decode(response.bytes)) as {truncated?:boolean;tree?:{type?:string;path?:string}[]};
  if(data.truncated||!Array.isArray(data.tree))throw new Error('repository_tree_incomplete');return data.tree.filter(entry=>entry.type==='blob'&&typeof entry.path==='string').map(entry=>safeRelative(entry.path!));
}

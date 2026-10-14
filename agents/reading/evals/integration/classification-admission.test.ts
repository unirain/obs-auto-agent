import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {validateHostRecords} from '../../src/app/records.js';
import {WorkspaceJournal,ApplicationInvocationJournal} from '../../src/app/journal.js';
import {PolicyGate,type TrustedPolicy} from '../../src/policy/gate.js';
import {StageExecutor,stageInputHash,type StageExecution} from '../../src/stages/executor.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {digest} from '../../src/stages/contracts.js';
import {policyFixture} from '../runtime/policy-fixtures.js';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'classification-admission-')),store=new FileObjectStore(join(root,'objects'));let policy:TrustedPolicy=policyFixture(),unavailable=false,preflights=0,queries=0,nextRun=0;
 const session=async(initialize=false,admit:()=>Promise<void>=async()=>{})=>{const local=join(root,'local-'+(++nextRun)),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:local,record_validator:validateHostRecords}),journal=new WorkspaceJournal(manager,await manager.restore('obs-notes-hub/reading',{allow_initialize:initialize}),'run'+nextRun);const gate=new PolicyGate(async()=>{if(unavailable)throw new Error('policy_read_failed');return policy;},check=>journal.commit('policy-checks/'+check.check_id,check));const deadline=new RunDeadline();const input:StageExecution={task:{project_id:'p',stage:'selection',capability:'classify_only',workspace_id:journal.handle.workspace_id,execution_scope:'production',context_id:digest('fixed classification context'),input_hash:'',checkpoint:'classify_query',state:'discovered',deadline:deadline.generation_deadline},subject:{subject_ref:'project:p',project_id:'p',candidate_id:'candidate_c1',execution_scope:'production',origin_source_ids:['claude_resources'],urls:['https://claude.com/resources/articles/tutorial'],main_url:'https://claude.com/resources/articles/tutorial'},cwd:local,prompt:'Classify the unlabelled fixture only',system_prompt:'Trusted fixed classification contract',schema:{type:'object'},model:'local-replay',tools:[],deadline,semantic_policy_hash:policy.semantic_policy_hash};input.task.input_hash=stageInputHash(input);const executor=new StageExecutor({preflight:async()=>{preflights++;await admit();},async *stream(){queries++;yield {message_id:'result',type:'result',summary:true,success:true,result:{},usage:{input_tokens:0,output_tokens:0,cost_usd:0,cost_status:'known'},observable:{}};}},gate,new ApplicationInvocationJournal(journal));return {local,journal,input,execute:()=>executor.execute(input)};};
 return {root,session,policy:()=>policy,set:(value:TrustedPolicy)=>{policy=value;},unavailable:()=>{unavailable=true;},counts:()=>({preflights,queries}),cleanup:()=>rm(root,{recursive:true,force:true})};
}
const revoke=(policy:TrustedPolicy,kind:string)=>{const next=structuredClone(policy);if(kind==='source_disabled')next.sources.claude_resources!.enabled=false;else if(kind==='domain_denied')next.denied_domains=['claude.com'];else if(kind==='project_paused')next.paused_projects=['p'];else if(kind==='semantic_changed')next.semantic_policy_hash=digest('new semantics');next.hash=digest('changed policy '+kind);return next;};
it.each(['source_disabled','domain_denied','project_paused'])('new classify_only %s refuses before admission, paid intent and stream, including a cold restart',async kind=>{
 const f=await fixture();try{
  f.set(revoke(f.policy(),kind));const first=await f.session(true);await expect(first.execute()).rejects.toThrow(kind);
  expect(first.journal.keys('invocations/')).toEqual([]);expect(f.counts()).toEqual({preflights:0,queries:0});await rm(first.local,{recursive:true,force:true});
  const cold=await f.session();await expect(cold.execute()).rejects.toThrow(kind);expect(cold.journal.keys('invocations/')).toEqual([]);expect(f.counts()).toEqual({preflights:0,queries:0});
  const checks=cold.journal.keys('policy-checks/');expect(checks.length).toBeGreaterThan(0);for(const key of checks)expect(await cold.journal.load(key)).toMatchObject({requested_capability:'classify_only',execution_permission:'denied'});
 }finally{await f.cleanup();}
});
it.each(['source_disabled','domain_denied','project_paused','semantic_changed','policy_unavailable'])('policy %s during asynchronous admission is rechecked before committing a paid intent and remains safe after cold restart',async kind=>{
 const f=await fixture();try{
  const first=await f.session(true,async()=>{if(kind==='policy_unavailable')f.unavailable();else f.set(revoke(f.policy(),kind));});
  await expect(first.execute()).rejects.toThrow(kind==='semantic_changed'?'semantic_policy_changed':kind);expect(first.journal.keys('invocations/')).toEqual([]);expect(f.counts()).toEqual({preflights:1,queries:0});
  await rm(first.local,{recursive:true,force:true});const cold=await f.session();expect(cold.journal.keys('invocations/')).toEqual([]);
  if(kind!=='semantic_changed')await expect(cold.execute()).rejects.toThrow(kind);else{cold.input.semantic_policy_hash=first.input.semantic_policy_hash;cold.input.task.input_hash=stageInputHash(cold.input);await expect(cold.execute()).rejects.toThrow('semantic_policy_changed');}
  expect(f.counts()).toEqual({preflights:1,queries:0});
 }finally{await f.cleanup();}
});

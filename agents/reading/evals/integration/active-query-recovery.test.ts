import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal,ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {buildUsageLedger} from '../../src/workspace/usage.js';
import {PolicyGate,type TrustedPolicy} from '../../src/policy/gate.js';
import {policyFixture} from '../runtime/policy-fixtures.js';
import {StageExecutor,stageInputHash,type StageExecution} from '../../src/stages/executor.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {digest} from '../../src/stages/contracts.js';
import type {QueryRequest} from '../../src/runtime/sdk.js';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'active-query-recovery-')),store=new FileObjectStore(join(root,'objects'));let policy:TrustedPolicy=policyFixture(),unavailable=false,nextRun=0,queries=0;const signals:AbortSignal[]=[];
 const session=async(initialize=false)=>{const local=join(root,'local-'+(++nextRun)),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,record_validator:validateHostRecords,local_root:local}),journal=new WorkspaceJournal(manager,await manager.restore('obs-notes-hub/reading',{allow_initialize:initialize}),'run'+nextRun);const gate=new PolicyGate(async()=>{if(unavailable)throw new Error('policy_unreadable');return policy;},check=>journal.commit('policy-checks/'+check.check_id,check));return {local,manager,journal,gate};};
 const input=(active:Awaited<ReturnType<typeof session>>,deadline:RunDeadline,refresh=60):StageExecution=>{const value:StageExecution={task:{project_id:'p',workspace_id:active.journal.handle.workspace_id,execution_scope:'production',context_id:digest('fixed context'),input_hash:'',stage:'selection',capability:'classify_only',state:'discovered',checkpoint:'active_classification',deadline:deadline.generation_deadline},subject:{subject_ref:'project:p',project_id:'p',candidate_id:'candidate_c1',execution_scope:'production',origin_source_ids:['claude_resources'],urls:['https://claude.com/resources/articles/tutorial'],main_url:'https://claude.com/resources/articles/tutorial'},prompt:'Fixed classification request',system_prompt:'Trusted stage prompt',schema:{type:'object'},model:'explicit-blocking-replay',cwd:active.local,tools:[],deadline,runtime_limits:{policy_refresh_seconds:refresh},semantic_policy_hash:policy.semantic_policy_hash};value.task.input_hash=stageInputHash(value);return value;};
 let readyResolve!:()=>void;const ready=new Promise<void>(resolve=>{readyResolve=resolve;});
 let unblock:()=>void=()=>{};
 const adapter={async *stream(request:QueryRequest){queries++;signals.push(request.signal);yield {message_id:'partial-observation',type:'assistant' as const,summary:false,usage:{input_tokens:11,output_tokens:3,cost_status:'unknown' as const,cost_usd:null},observable:{provider_request_id:'fixture-request'}};await new Promise<void>(resolve=>{unblock=resolve;readyResolve();if(request.signal.aborted)resolve();else request.signal.addEventListener('abort',()=>resolve(),{once:true});});throw new Error('replayed_sdk_abort');}};
 return {root,store,session,input,adapter,ready,signals,queries:()=>queries,policy:()=>policy,revoke:(kind:string)=>{if(kind==='unavailable')unavailable=true;else{policy=structuredClone(policy);if(kind==='semantic')policy.semantic_policy_hash=digest('new semantics');else policy.paused=true;policy.hash=digest('changed '+kind);}},reset:()=>{unavailable=false;policy=policyFixture();},terminate:()=>unblock(),cleanup:()=>rm(root,{recursive:true,force:true})};
}
it('the actual 55-minute generation timer aborts an active query; prior artifacts and unknown usage survive a cold host without another query',async()=>{
 const f=await fixture();let running:Promise<unknown>|undefined;try{
  const first=await f.session(true);const artifact='projects/p/research/prior.txt';await first.journal.commitMany({},'research_complete',[{path:artifact,bytes:Buffer.from('committed prior evidence'),role:'evidence',project_id:'p'}]);
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T06:00:00Z'));const start=Date.now()-54*60_000,deadline=new RunDeadline(start),input=f.input(first,deadline);
  running=new StageExecutor(f.adapter,first.gate,new ApplicationInvocationJournal(first.journal)).execute(input);const observed=running.catch(error=>error);await f.ready;
  expect((await first.journal.load<{status:string}>(first.journal.keys('invocations/')[0]!))!.status).toBe('running');
  await vi.advanceTimersByTimeAsync(60_000);const error=await observed;expect(error).toMatchObject({message:'request_unknown:run_deadline',cause:{message:'replayed_sdk_abort'}});expect(f.signals[0]!.aborted).toBe(true);expect(deadline.mayStart()).toBe(false);
  expect(Date.now()-start).toBe(55*60_000);expect(deadline.deadline-Date.now()).toBe(5*60_000);
  await expect(new StageExecutor(f.adapter,first.gate,new ApplicationInvocationJournal(first.journal)).execute(input)).rejects.toThrow('run_deadline');expect(f.queries()).toBe(1);
  vi.useRealTimers();await rm(first.local,{recursive:true,force:true});const cold=await f.session();
  expect(Buffer.from(await cold.manager.readFile(cold.journal.handle,artifact)).toString()).toBe('committed prior evidence');
  const record=await new ApplicationInvocationJournal(cold.journal).find('project:p',input.task.input_hash,'classify_only');expect(record).toMatchObject({status:'unknown',usage:{input_tokens:11,output_tokens:3,cost_status:'unknown',cost_usd:null}});
  const resumed={...input,cwd:cold.local,deadline:new RunDeadline()};resumed.task={...input.task,deadline:resumed.deadline.generation_deadline};await expect(new StageExecutor(f.adapter,cold.gate,new ApplicationInvocationJournal(cold.journal)).execute(resumed)).rejects.toThrow('request_unknown');expect(f.queries()).toBe(1);
  expect(buildUsageLedger([cold.journal.handle]).total).toMatchObject({invocation_count:1,input_tokens:11,output_tokens:3,cost_status:'unknown',cost_usd:null});
 }finally{vi.useRealTimers();f.terminate();if(running)await running.catch(()=>{});await f.cleanup();}
});
it.each(['pause','unavailable','semantic'])('active query refresh detects %s and cold recovery refuses a replacement even after permission returns',async kind=>{
 const f=await fixture();let running:Promise<unknown>|undefined;try{
  const first=await f.session(true);let refreshDone!:()=>void;const refreshedCheckpoint=new Promise<void>(resolve=>{refreshDone=resolve;}),check=first.gate.check.bind(first.gate);first.gate.check=async(...args)=>{const result=await check(...args);if(args[2]==='active_query_refresh')refreshDone();return result;};vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T06:00:00Z'));const input=f.input(first,new RunDeadline(),1);
  running=new StageExecutor(f.adapter,first.gate,new ApplicationInvocationJournal(first.journal)).execute(input);const observed=running.catch(error=>error);await f.ready;f.revoke(kind);
  await vi.advanceTimersByTimeAsync(1_000);await refreshedCheckpoint;await Promise.resolve();expect(f.signals[0]!.aborted).toBe(true);const error=await observed;expect(error).toMatchObject({message:'request_unknown:policy_revoked'});
  const checks=await Promise.all(first.journal.keys('policy-checks/').map(key=>first.journal.load<{checkpoint:string;semantic_policy_hash:string|null;execution_permission:string}>(key)));const refreshed=checks.find(check=>check?.checkpoint==='active_query_refresh');expect(refreshed).toBeDefined();if(kind==='semantic')expect(refreshed!.semantic_policy_hash).not.toBe(input.semantic_policy_hash);
  vi.useRealTimers();await rm(first.local,{recursive:true,force:true});f.reset();const cold=await f.session();const resumed={...input,cwd:cold.local,deadline:new RunDeadline()};resumed.task={...input.task,deadline:resumed.deadline.generation_deadline};
  await expect(new StageExecutor(f.adapter,cold.gate,new ApplicationInvocationJournal(cold.journal)).execute(resumed)).rejects.toThrow('request_unknown');expect(f.queries()).toBe(1);
  const record=await new ApplicationInvocationJournal(cold.journal).find('project:p',input.task.input_hash,'classify_only');expect(record).toMatchObject({status:'unknown',usage:{input_tokens:11,cost_status:'unknown',cost_usd:null}});
 }finally{vi.useRealTimers();f.terminate();if(running)await running.catch(()=>{});await f.cleanup();}
});
it('a policy checkpoint that crosses the generation cutoff cannot prepare a new query',async()=>{
 const f=await fixture();try{
  const first=await f.session(true);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T06:00:00Z'));const input=f.input(first,new RunDeadline()),require=first.gate.require.bind(first.gate);let checks=0;
  first.gate.require=async(...args)=>{const result=await require(...args);if(++checks===2)vi.setSystemTime(input.deadline.generation_deadline);return result;};
  await expect(new StageExecutor(f.adapter,first.gate,new ApplicationInvocationJournal(first.journal)).execute(input)).rejects.toThrow('run_deadline');expect(first.journal.keys('invocations/')).toEqual([]);expect(f.queries()).toBe(0);
 }finally{vi.useRealTimers();f.terminate();await f.cleanup();}
});

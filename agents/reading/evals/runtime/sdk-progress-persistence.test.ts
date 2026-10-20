import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {SDKMessage,SDKThinkingTokensMessage} from '@anthropic-ai/claude-agent-sdk';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal,ApplicationInvocationJournal} from '../../src/app/journal.js';
import {StageExecutor,stageInputHash,type StageExecution} from '../../src/stages/executor.js';
import {normalizeSdkStream,type ModelAdapter} from '../../src/runtime/sdk.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {digest} from '../../src/stages/contracts.js';
import {policyFixture,subjectFixture} from './policy-fixtures.js';
import type {InvocationRecord} from '../../src/contracts/index.js';

it.each(['success','interruption'] as const)('cold-restores coalesced thinking with %s and never repeats a confirmed or unknown paid call',async(outcome)=>{
 const root=await mkdtemp(join(tmpdir(),'thinking-persistence-'));
 try{
  const store=new FileObjectStore(join(root,'objects')),workspace='obs-notes-hub/reading-preview/thinking-'+outcome;
  const manager=new ImmutableWorkspaceManager({store,scope:'preview',local_root:join(root,'first'),verify_preflight:false});
  const journal=new WorkspaceJournal(manager,await manager.restore(workspace,{allow_initialize:true}),'run-1'),port=new ApplicationInvocationJournal(journal);
  const deadline=new RunDeadline(),task={project_id:'p',stage:'selection' as const,execution_scope:'preview' as const,context_id:digest('context'),input_hash:digest('pending'),checkpoint:'c',capability:'classify_only' as const,deadline:deadline.generation_deadline,workspace_id:workspace,state:'discovered' as const};
  const input:StageExecution={task,subject:{...subjectFixture(),subject_ref:'project:p',project_id:'p',execution_scope:'preview'},prompt:'classify',system_prompt:'fixed',schema:{type:'object'},cwd:root,model:'test',tools:[],deadline};input.task.input_hash=stageInputHash(input);
  let calls=0;const failure=new Error('native_stream_interrupted');
  const usage=(input_tokens:number,output_tokens:number)=>({input_tokens,output_tokens});
  const assistant=(id:string,input_tokens:number,output_tokens:number)=>({type:'assistant',uuid:id,session_id:'s',message:{id:'provider-'+id,usage:usage(input_tokens,output_tokens)}} as unknown as SDKMessage);
  async function* native(){
   // The actual immutable prepared record precedes the one simulated external call.
   const prepared=await port.find('project:p',input.task.input_hash,'classify_only');expect(prepared?.status).toBe('prepared');calls++;
   yield assistant('a',7,3);
   for(let i=0;i<1000;i++)yield {type:'system',subtype:'thinking_tokens',uuid:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,session_id:'s',estimated_tokens:i*10,estimated_tokens_delta:10} satisfies SDKThinkingTokensMessage;
   if(outcome==='interruption')throw failure;
   yield {type:'result',uuid:'result',session_id:'s',subtype:'success',is_error:false,result:'{"allowed":true}',modelUsage:{model:{inputTokens:9,cacheReadInputTokens:0,cacheCreationInputTokens:0,outputTokens:4,costUSD:0.01,costBasis:'calculated'}}} as unknown as SDKMessage;
   yield assistant('late',2,1);
  }
  const adapter:ModelAdapter={stream:()=>normalizeSdkStream(native())},gate=new PolicyGate(async()=>policyFixture(),async()=>{}),executor=new StageExecutor(adapter,gate,port);
  if(outcome==='success')expect((await executor.execute(input)).result).toBe('{"allowed":true}');
  else await expect(executor.execute(input)).rejects.toMatchObject({message:'request_unknown',cause:failure});
  const coldManager=new ImmutableWorkspaceManager({store,scope:'preview',local_root:join(root,'cold'),verify_preflight:false}),cold=await coldManager.restore(workspace),coldJournal=new WorkspaceJournal(coldManager,cold,'run-2');
  const id=(cold.records.invocation_order as string[])[0]!,record=(await coldJournal.load<InvocationRecord>('invocations/'+id))!;
  expect(record.status).toBe(outcome==='success'?'succeeded':'unknown');expect(record.messages.map(m=>m.message_id)).toEqual(outcome==='success'?['a','result','late']:['a']);
  expect(record.usage).toMatchObject({input_tokens:outcome==='success'?9:7,output_tokens:outcome==='success'?4:3,cost_status:outcome==='success'?'known':'unknown',cost_usd:outcome==='success'?0.01:null});
  expect(Object.keys(cold.records).filter(k=>k.startsWith('observations/'))).toHaveLength(outcome==='success'?3:1);
  if(outcome==='success')expect(cold.records['observations/'+id+'/result']).toMatchObject({coalesced_thinking_progress:{schema_version:1,count:1000,last_estimated_tokens:9990,billing_status:'not_billing'}});
  else expect(cold.records['responses/'+id]).toBeUndefined();
  const replay=new StageExecutor(adapter,gate,new ApplicationInvocationJournal(coldJournal));
  if(outcome==='success')expect((await replay.execute(input)).result).toBe('{"allowed":true}');else await expect(replay.execute(input)).rejects.toThrow('request_unknown');
  expect(calls).toBe(1);expect((await coldManager.restore(workspace)).revision).toBe(cold.revision);
 }finally{await rm(root,{recursive:true,force:true});}
});

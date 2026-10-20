import {it,expect} from 'vitest';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {normalizeSdkStream,type RuntimeMessage} from '../../src/runtime/sdk.js';
const progress=(i:number)=>({type:'tool_progress',uuid:'progress-'+i,session_id:'session',tool_use_id:'controlled-'+i,tool_name:'mcp__reading__read_main',elapsed_time_seconds:i,private_arguments:'never persist this body'} as unknown as SDKMessage);
const assistant=(id:string,input:number,output:number)=>({type:'assistant',uuid:id,session_id:'session',message:{id:'provider-'+id,model:'model',usage:{input_tokens:input,output_tokens:output},content:[{type:'text',text:'private source body'}]}} as unknown as SDKMessage);
const result={type:'result',uuid:'result',session_id:'session',subtype:'success',is_error:false,result:'{"answer":"ok"}',modelUsage:{model:{inputTokens:7,cacheReadInputTokens:0,cacheCreationInputTokens:0,outputTokens:3,costUSD:0.01,costBasis:'calculated'}}} as unknown as SDKMessage;
const thinkingId=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}` as const;
const thinking=(i:number,estimate=i*10)=>({type:'system',subtype:'thinking_tokens',uuid:thinkingId(i),session_id:'session',estimated_tokens:estimate,estimated_tokens_delta:10,user_message_uuid:'user',private_thought:'never retain thinking text'} satisfies SDKMessage & {private_thought:string});
async function* stream(rows:SDKMessage[]){for(const row of rows)yield row;}
it('coalesces a thousand no-usage progress frames without a thousand durable events and preserves the complete next billing/result facts',async()=>{
 const rows:RuntimeMessage[]=[];for await(const row of normalizeSdkStream(stream([...Array.from({length:1000},(_,i)=>progress(i)),assistant('a',7,3),result])))rows.push(row);
 expect(rows.map(row=>row.message_id)).toEqual(['a','result']);expect(rows[0]!.usage).toMatchObject({input_tokens:7,output_tokens:3});expect(rows[1]!.summary).toBe(true);expect(rows[1]!.result).toBe('{"answer":"ok"}');
 expect(rows[0]!.observable.coalesced_tool_progress).toEqual({schema_version:1,count:1000,first_sdk_message_id:'progress-0',last_sdk_message_id:'progress-999',tool_use_id:'controlled-999',tool_name:'mcp__reading__read_main',elapsed_time_seconds:999});expect(rows[0]!.observable.provider_message_id).toBe('provider-a');expect(JSON.stringify(rows)).not.toContain('private source body');expect(JSON.stringify(rows)).not.toContain('never persist');
});
it('does not reorder/drop a query summary or usage arriving after it, including progress between them',async()=>{
 const rows:RuntimeMessage[]=[];for await(const row of normalizeSdkStream(stream([result,progress(1),progress(2),assistant('late',2,1)])))rows.push(row);
 expect(rows.map(row=>row.message_id)).toEqual(['result','late']);expect(rows[0]!.summary).toBe(true);expect(rows[1]!.summary).toBe(false);expect(rows[1]!.usage).toMatchObject({input_tokens:2,output_tokens:1,cost_usd:null,cost_status:'unknown'});expect((rows[1]!.observable.coalesced_tool_progress as any).count).toBe(2);
});
it('propagates the original SDK failure after retained usage without inventing a terminal result or zero billing',async()=>{
 const failure=new Error('native wire lost'),rows:RuntimeMessage[]=[];async function* broken(){yield assistant('a',7,3);yield progress(1);throw failure;}
 await expect((async()=>{for await(const row of normalizeSdkStream(broken()))rows.push(row);})()).rejects.toBe(failure);
 expect(rows).toHaveLength(1);expect(rows[0]!.summary).toBe(false);expect(rows[0]!.usage).toMatchObject({input_tokens:7,output_tokens:3,cost_status:'unknown',cost_usd:null});expect(rows[0]!.observable).not.toHaveProperty('coalesced_tool_progress');
});
it('coalesces interleaved thinking estimates/tool progress and preserves result and late billing without charging estimated tokens',async()=>{
 const diagnostics=Array.from({length:1000},(_,i)=>[thinking(i),progress(i)]).flat(),rows:RuntimeMessage[]=[];
 for await(const row of normalizeSdkStream(stream([...diagnostics,thinking(1000,3),assistant('a',7,3),result,thinking(1001),assistant('late',2,1)])))rows.push(row);
 expect(rows.map(row=>row.message_id)).toEqual(['a','result','late']);
 expect(rows[0]!.observable.coalesced_thinking_progress).toEqual({schema_version:1,count:1001,first_sdk_message_id:thinkingId(0),last_sdk_message_id:thinkingId(1000),last_estimated_tokens:3,last_estimated_tokens_delta:10,billing_status:'not_billing'});
 expect((rows[0]!.observable.coalesced_tool_progress as any).count).toBe(1000);expect(rows[0]!.usage).toMatchObject({input_tokens:7,output_tokens:3,cost_usd:null,cost_status:'unknown'});
 expect(rows[1]!.summary).toBe(true);expect(rows[1]!.usage).toEqual({input_tokens:7,output_tokens:3,cost_usd:0.01,cost_status:'known'});expect(rows[1]!.observable).not.toHaveProperty('coalesced_thinking_progress');
 expect(rows[2]!.usage).toMatchObject({input_tokens:2,output_tokens:1});expect((rows[2]!.observable.coalesced_thinking_progress as any).count).toBe(1);expect(JSON.stringify(rows)).not.toContain('never retain');
});
it('keeps non-thinking system lifecycle events and malformed thinking boundaries in order',async()=>{
 const other={type:'system',subtype:'api_retry',uuid:thinkingId(9999),session_id:'session',attempt:1,max_retries:2,retry_delay_ms:10,error_status:429,error:'rate_limit'} satisfies SDKMessage,malformed={...thinking(2),estimated_tokens:Number.NaN},rows:RuntimeMessage[]=[];
 for await(const row of normalizeSdkStream(stream([thinking(1),other,thinking(2),malformed,result])))rows.push(row);
 expect(rows.map(row=>row.message_id)).toEqual([thinkingId(9999),thinkingId(2),'result']);expect(rows[0]!.observable.subtype).toBe('api_retry');expect((rows[0]!.observable.coalesced_thinking_progress as any).count).toBe(1);
 expect((rows[1]!.observable.coalesced_thinking_progress as any).count).toBe(1);expect(rows[1]!.usage.cost_status).toBe('unknown');expect(rows[2]!.summary).toBe(true);
});
it('keeps an interrupted thinking stream unknown and propagates its original error without a terminal receipt',async()=>{
 const failure=new Error('thinking stream interrupted'),rows:RuntimeMessage[]=[];async function* broken(){yield assistant('a',7,3);yield thinking(1);yield thinking(2);throw failure;}
 await expect((async()=>{for await(const row of normalizeSdkStream(broken()))rows.push(row);})()).rejects.toBe(failure);
 expect(rows).toHaveLength(1);expect(rows[0]!.summary).toBe(false);expect(rows[0]!.usage).toMatchObject({input_tokens:7,output_tokens:3,cost_status:'unknown'});expect(rows[0]!.observable).not.toHaveProperty('coalesced_thinking_progress');
});

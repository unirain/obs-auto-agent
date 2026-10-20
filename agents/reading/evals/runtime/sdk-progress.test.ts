import {it,expect} from 'vitest';
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk';
import {normalizeSdkStream,type RuntimeMessage} from '../../src/runtime/sdk.js';
const progress=(i:number)=>({type:'tool_progress',uuid:'progress-'+i,session_id:'session',tool_use_id:'controlled-'+i,tool_name:'mcp__reading__read_main',elapsed_time_seconds:i,private_arguments:'never persist this body'} as unknown as SDKMessage);
const assistant=(id:string,input:number,output:number)=>({type:'assistant',uuid:id,session_id:'session',message:{id:'provider-'+id,model:'model',usage:{input_tokens:input,output_tokens:output},content:[{type:'text',text:'private source body'}]}} as unknown as SDKMessage);
const result={type:'result',uuid:'result',session_id:'session',subtype:'success',is_error:false,result:'{"answer":"ok"}',modelUsage:{model:{inputTokens:7,cacheReadInputTokens:0,cacheCreationInputTokens:0,outputTokens:3,costUSD:0.01,costBasis:'calculated'}}} as unknown as SDKMessage;
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

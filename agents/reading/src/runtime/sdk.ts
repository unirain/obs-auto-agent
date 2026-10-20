import {readInstalledSdkVersion} from './versions.js';
import path from 'node:path';
import {query,createSdkMcpServer,tool,type Options,type SDKMessage,type ModelUsage} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {Usage} from '../contracts/index.js';
export const SDK_VERSION='0.3.296';
export type RuntimeMessage={message_id:string;type:string;summary:boolean;usage:Usage;result?:unknown;success?:boolean;observable:Record<string,unknown>};
export type ToolDefinition={name:string;description:string;run:(args:Record<string,unknown>)=>Promise<unknown>};
export type QueryRequest={prompt:string;system_prompt:string;schema:object;cwd:string;vault_root?:string;model:string;signal:AbortSignal;tools:ToolDefinition[];skills?:string[];max_output_tokens?:number;max_turns?:number};
export interface ModelAdapter {preflight?:()=>Promise<void>;stream(request:QueryRequest):AsyncIterable<RuntimeMessage> }
/** Only a trusted host adapter may raise this before calling SDK query(); it is never inferred from an SDK/network error. */
export class QueryNotStartedError extends Error {readonly request_started=false;constructor(readonly reason:string){super(reason);this.name='QueryNotStartedError';}}
export function summarizeModelUsage(models:Record<string,ModelUsage>):Usage {
  let input_tokens=0,output_tokens=0,cost_usd=0;let known=Object.keys(models).length>0;
  for(const usage of Object.values(models)){input_tokens+=usage.inputTokens+usage.cacheReadInputTokens+usage.cacheCreationInputTokens;output_tokens+=usage.outputTokens;
    if(!Number.isFinite(usage.costUSD)||usage.costBasis==='unknown')known=false;else cost_usd+=usage.costUSD;}
  return {input_tokens,output_tokens,cost_usd:known?cost_usd:null,cost_status:known?'known':'unknown'};
}
const unavailableUsage=():Usage=>({input_tokens:0,output_tokens:0,cost_usd:null,cost_status:'unknown'});
export function mcpToolContent(result:unknown):CallToolResult {
  if(result&&typeof result==='object'&&'content' in result&&Array.isArray(result.content)){
    for(const block of result.content){if(!block||typeof block!=='object')throw new Error('tool_content_invalid');
      const typed=block as Record<string,unknown>;
      if(typed.type==='image'){if(!['image/png','image/jpeg','image/webp'].includes(String(typed.mimeType))||typeof typed.data!=='string'||typed.data.length>14_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(typed.data))throw new Error('tool_image_invalid');}
      else if(typed.type!=='text'||typeof typed.text!=='string')throw new Error('tool_content_denied');}
    return result as CallToolResult;
  }
  return {content:[{type:'text',text:JSON.stringify(result)}]};
}
export function normalizeSdkMessage(message:SDKMessage):RuntimeMessage {
  const raw=message as unknown as Record<string,unknown>;const message_id=typeof raw.uuid==='string'?raw.uuid:`${message.type}:${String(raw.subtype??'')}:${String(raw.session_id??'')}`;
  const actualModel=(raw.message as {model?:unknown}|undefined)?.model;const providerId=(raw.message as {id?:unknown}|undefined)?.id;const lifecycle={provider_message_id:typeof providerId==='string'?providerId:null,actual_models:raw.modelUsage&&typeof raw.modelUsage==='object'?Object.keys(raw.modelUsage):typeof actualModel==='string'?[actualModel]:[],session_id:typeof raw.session_id==='string'?raw.session_id:null,provider_request_id:typeof raw.request_id==='string'?raw.request_id:null};
  if(message.type==='result'){const usage=summarizeModelUsage(message.modelUsage);const zeroedError=message.subtype!=='success'&&usage.input_tokens===0&&usage.output_tokens===0;
    return {message_id,type:'result',summary:!zeroedError,usage:zeroedError?{...usage,cost_usd:null,cost_status:'unknown'}:usage,success:message.subtype==='success'&&!message.is_error,
    ...(message.subtype==='success'?{result:message.structured_output??message.result}:{}),observable:{...lifecycle,subtype:message.subtype,num_turns:message.num_turns,duration_ms:message.duration_ms,
      ...(message.subtype==='success'?{permission_denials:message.permission_denials,stop_reason:message.stop_reason}:{}),modelUsage:message.modelUsage}};}
  // Content and raw prompts may contain private material. Persist observable lifecycle facts, not credentials or text transcripts.
  let usage=unavailableUsage();const step=(raw.message as {usage?:Record<string,unknown>}|undefined)?.usage;
  if(message.type==='assistant'&&step){const number=(key:string)=>typeof step[key]==='number'&&Number.isFinite(step[key])?step[key] as number:0;usage={input_tokens:number('input_tokens')+number('cache_creation_input_tokens')+number('cache_read_input_tokens'),output_tokens:number('output_tokens'),cost_usd:null,cost_status:'unknown'};}
  return {message_id,type:message.type,summary:false,usage,observable:{...lifecycle,type:message.type,...(typeof raw.subtype==='string'?{subtype:raw.subtype}:{})}};
}
/** Tool progress has no usage fields in pinned SDK0.3.296. Coalesce only these
 * diagnostic frames onto the next durable event; never drop/reorder usage or results.
 * Progress left at stream interruption is unavailable diagnostic detail, not zero usage.
 */
export async function* normalizeSdkStream(messages:AsyncIterable<SDKMessage>):AsyncIterable<RuntimeMessage>{
 let progress:{schema_version:1;count:number;first_sdk_message_id:string;last_sdk_message_id:string;tool_use_id:string;tool_name:string;elapsed_time_seconds:number}|undefined;
 for await(const message of messages){
  if(message.type==='tool_progress'){
   const count=(progress?.count??0)+1;if(!Number.isSafeInteger(count))throw new Error('sdk_progress_count_invalid');
   progress={schema_version:1,count,first_sdk_message_id:progress?.first_sdk_message_id??message.uuid,last_sdk_message_id:message.uuid,tool_use_id:message.tool_use_id,tool_name:message.tool_name,elapsed_time_seconds:message.elapsed_time_seconds};continue;
  }
  const normalized=normalizeSdkMessage(message);if(progress){normalized.observable={...normalized.observable,coalesced_tool_progress:progress};progress=undefined;}yield normalized;
 }
}
export type SdkSecrets={api_key:string;base_url?:string;provider?:'anthropic'|'deepseek'};
export function modelProvider(secrets:SdkSecrets):'anthropic'|'deepseek'{return secrets.provider??(secrets.base_url&&new URL(secrets.base_url).hostname==='api.deepseek.com'?'deepseek':'anthropic');}
/** Explicit replacement environment keeps OSS/GitHub secrets out of the SDK subprocess. Controlled tools spawn with their own clean environment. */
export function sdkEnvironment(secrets:SdkSecrets,home:string):Record<string,string>{
  return {PATH:process.env.PATH??'/usr/bin:/bin',HOME:home,LANG:'C.UTF-8',...(modelProvider(secrets)==='deepseek'?{ANTHROPIC_AUTH_TOKEN:secrets.api_key}:{ANTHROPIC_API_KEY:secrets.api_key}),CLAUDE_AGENT_SDK_CLIENT_APP:'obs-reading-agent/0.1.0',
    ...(secrets.base_url?{ANTHROPIC_BASE_URL:secrets.base_url}:{})};
}
export function sdkOptions(request:QueryRequest,secrets:SdkSecrets,home:string):Options {
  const maxTurns=request.max_turns??40;if(!Number.isSafeInteger(maxTurns)||maxTurns<1)throw new Error('sdk_turn_limit_invalid');const maxOutput=request.max_output_tokens??8192;if(!Number.isInteger(maxOutput)||maxOutput<256||maxOutput>131072)throw new Error('output_token_limit_invalid');
  const controller=new AbortController();if(request.signal.aborted)controller.abort();else request.signal.addEventListener('abort',()=>controller.abort(),{once:true});
  const mcp=createSdkMcpServer({name:'reading',version:'1.0.0',tools:request.tools.map(definition=>tool(definition.name,definition.description,
    {input:z.record(z.string(),z.unknown())},async({input})=>mcpToolContent(await definition.run(input))))});
  const allowed=request.tools.map(definition=>`mcp__reading__${definition.name}`);
  const skillActivation=request.tools.find(definition=>definition.name==='activate_skill');
  const vaultRoot=request.vault_root??request.cwd;const relativeVault=path.relative(path.resolve(request.cwd),path.resolve(vaultRoot));if(relativeVault==='..'||relativeVault.startsWith('..'+path.sep)||path.isAbsolute(relativeVault))throw new Error('sdk_vault_root_outside_project_view');
  return {cwd:request.cwd,model:request.model,env:{...sdkEnvironment(secrets,home),VAULT_ROOT:vaultRoot,CLAUDE_CODE_MAX_OUTPUT_TOKENS:String(maxOutput)},abortController:controller,
    tools:request.skills?.length?['Skill']:[],allowedTools:request.skills?.length?[...allowed,'Skill']:allowed,disallowedTools:['Bash','Read','Write','Edit','Glob','Grep','WebFetch','WebSearch','Agent','Task','NotebookEdit'],
    mcpServers:{reading:mcp},settingSources:request.skills?.length?['project']:[],skills:request.skills??[],persistSession:false,permissionMode:'default',
    ...(request.skills?.length?{hooks:{PreToolUse:[{matcher:'Skill',hooks:[async hook=>{
      if(hook.hook_event_name!=='PreToolUse')return {};
      const name=(hook.tool_input as {skill?:unknown})?.skill;
      if(typeof name!=='string'||!request.skills?.includes(name)||!skillActivation)return {hookSpecificOutput:{hookEventName:'PreToolUse' as const,permissionDecision:'deny' as const,permissionDecisionReason:'Only fixed trusted skill activation is allowed'}};
      await skillActivation.run({name});return {hookSpecificOutput:{hookEventName:'PreToolUse' as const,permissionDecision:'allow' as const}};
    }]}]}}:{}),
    canUseTool:async(name,input)=>allowed.includes(name)||(name==='Skill'&&typeof input.skill==='string'&&request.skills?.includes(input.skill))?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'Only controlled reading tools and fixed skills are available'},
    systemPrompt:request.system_prompt,...(modelProvider(secrets)==='anthropic'?{outputFormat:{type:'json_schema' as const,schema:request.schema as Record<string,unknown>}}:{}),maxTurns};
}
export class ClaudeSdkAdapter implements ModelAdapter {
  constructor(private readonly secrets:SdkSecrets,private readonly home:string){}
  preflight=async()=>{const installed=await readInstalledSdkVersion();if(installed.sdk_version!==SDK_VERSION)throw new QueryNotStartedError('installed_sdk_version_mismatch');};
  async *stream(request:QueryRequest):AsyncIterable<RuntimeMessage>{
    await this.preflight();const compatible=modelProvider(this.secrets)==='deepseek';
    const options=sdkOptions(request,this.secrets,this.home);if(compatible)options.env={...options.env,ANTHROPIC_MODEL:request.model,ANTHROPIC_SMALL_FAST_MODEL:request.model,ANTHROPIC_DEFAULT_HAIKU_MODEL:request.model,ANTHROPIC_DEFAULT_SONNET_MODEL:request.model,ANTHROPIC_DEFAULT_OPUS_MODEL:request.model};
    const prompt=compatible?`${request.prompt}\nReturn JSON only matching this exact schema. No Markdown fences or additional text.\n${JSON.stringify(request.schema)}`:request.prompt;
    const session=query({prompt,options});
    try{for await(const normalized of normalizeSdkStream(session)){if(compatible){normalized.usage={...normalized.usage,cost_usd:null,cost_status:'unknown'};normalized.observable={...normalized.observable,provider:'deepseek',pricing_status:'unknown',requested_model:request.model};}yield normalized;}}finally{session.close();}
  }
}

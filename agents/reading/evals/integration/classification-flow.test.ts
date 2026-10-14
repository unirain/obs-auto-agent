import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal,ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController,type ControllerPorts,type HostProject} from '../../src/app/controller.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {policyFixture} from '../runtime/policy-fixtures.js';
import {buildContext} from '../../src/context/index.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {UrlGateway} from '../../src/tools/fetch.js';
import {sdkOptions,type QueryRequest} from '../../src/runtime/sdk.js';
import {digest,type Classification} from '../../src/stages/contracts.js';
import type {SourceSlice} from '../../src/tools/segments.js';
import {parseDispatch} from '../../src/config/dispatch.js';
type ResultKind='allowed'|'excluded'|'unresolved';
const tutorial='AgentHubX stores intent before retrying an action, making its effects idempotent.';
const announcement='AgentHubX is launching today; upgrade to our new product plan.';
const mixed='AgentHubX is new. Its checkpoint mechanism saves evidence before an external action.';
const marketing='AgentHubX transforms everything. Subscribe now for revolutionary productivity.';
async function fixture(kind:ResultKind,paragraph=tutorial,source:'manual'|'langchain'|'claude'='manual',attemptForbidden=false){
 const root=await mkdtemp(join(tmpdir(),'classification-flow-')),store=new FileObjectStore(join(root,'objects')),policy=policyFixture();let runs=0;const calls:string[]=[],fetches:string[]=[],refusals:string[]=[],presented:string[]=[];
 const url=source==='langchain'?'https://www.langchain.com/blog/agenthubx':source==='claude'?'https://claude.com/resources/articles/agenthubx':'https://independent.dev/agenthubx';
 const html=`<html><head><title>AgentHubX</title></head><body><main><h1>AgentHubX</h1><p>${paragraph}</p><p>Only one writer can commit a generation.</p><a href="https://arxiv.org/abs/1234.5678">Related paper</a></main></body></html>`;
 const templates=Object.fromEntries(await Promise.all(['selection','research','writing','review'].map(async stage=>[stage,await readFile('agents/reading/prompts/'+stage+'.md','utf8')])) ) as Record<string,string>;
 const session=async(initialize=false)=>{const local=join(root,'restored-'+(++runs)),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:local,record_validator:validateHostRecords}),journal=new WorkspaceJournal(manager,await manager.restore('obs-notes-hub/reading',{allow_initialize:initialize}),'classify-run-'+runs),gate=new PolicyGate(async()=>policy,check=>journal.commit('policy-checks/'+check.check_id,check)),deadline=new RunDeadline();
  const adapter={async *stream(request:QueryRequest){const payload=JSON.parse(request.prompt) as {task:string;data:{candidate?:Record<string,unknown>}},classification=Object.hasOwn((request.schema as {properties:object}).properties,'content_eligibility');if(!classification&&payload.task!=='selection')throw new Error('unexpected_research_or_write');
   const main=await request.tools.find(tool=>tool.name==='read_main')!.run({}) as SourceSlice;expect(main.url).toBe(url);const anchor=main.lines.find(line=>line.text.includes(paragraph));expect(anchor).toBeDefined();presented.push(anchor!.text);
   if(classification){calls.push('classify');expect(payload.data.candidate).not.toHaveProperty('topic');expect(payload.data.candidate).not.toHaveProperty('content_type');
    if(attemptForbidden){const options=sdkOptions(request,{api_key:'fixture-not-sent'},join(root,'sdk-home'));expect(request.tools.map(tool=>tool.name).sort()).toEqual(['read_candidate','read_main','read_related_summary','read_source']);
     for(const name of ['follow_reference','render_diagram','write_note','publish']){expect(request.tools.find(tool=>tool.name===name)).toBeUndefined();const decision=await options.canUseTool!('mcp__reading__'+name,{input:{url:'https://arxiv.org/abs/1234.5678'}},{} as never);expect(decision?.behavior).toBe('deny');refusals.push(name);}
     for(const name of ['Read','Write','Bash','Skill'])expect((await options.canUseTool!(name,{file_path:'/tmp/notes.md',command:'publish',skill:'obsidian-note'},{} as never))?.behavior).toBe('deny');
     await expect(request.tools.find(tool=>tool.name==='read_source')!.run({snapshot_hash:digest('unregistered paper'),source_url:'https://arxiv.org/abs/1234.5678'})).rejects.toThrow('selection_supplement_denied');
    }
    const result:Classification={content_eligibility:kind,content_type:kind==='excluded'?(paragraph===marketing?'marketing':'product_announcement'):'engineering',topic:'agents',reason_codes:kind==='excluded'?[paragraph===marketing?'marketing':'product_announcement']:kind==='unresolved'?['mixed_content_unresolved']:[],evidence:[{start_line:anchor!.line,end_line:anchor!.line,excerpt:paragraph}]};
    yield {message_id:'classification-'+calls.length,type:'result' as const,summary:true,success:true,result,usage:{input_tokens:10,output_tokens:3,cost_status:'unknown' as const,cost_usd:null},observable:{}};
   }else{calls.push('select');yield {message_id:'selection-'+calls.length,type:'result' as const,summary:true,success:true,result:{decision:'defer',reason_codes:['local_value_probe_complete'],reason:'The value stage is intentionally bounded in this classifier fixture.',dimension_ratings:{relevance:'strong',mechanism:'strong',evidence:'partial',transferability:'strong',increment:'unknown'},questions:[],related_note_ids:[],evidence_ids:[]},usage:{input_tokens:5,output_tokens:2,cost_status:'unknown' as const,cost_usd:null},observable:{}};}
  }};
  const executor=new StageExecutor(adapter,gate,new ApplicationInvocationJournal(journal));
  const ports:ControllerPorts={journal,gate,deadline,sources:[],context:async()=>{const context=buildContext({index:[],query:'AgentHubX classifier boundary',heldout:{urls:new Set(),note_paths:new Set()},preferences_hash:digest('preferences'),skill_commit:'a'.repeat(40),skill_hash:digest('unused classification skill'),prompt_hash:digest(Buffer.concat(Object.values(templates).map(text=>Buffer.from(text)))),prompt_templates:templates,model:'explicit-classification-replay',evidence_versions:[]});if(!await journal.load('contexts/'+context.context_id))await journal.commitMany({['contexts/'+context.context_id]:context},'generation_context_fixed');return context;},environment:async(_project,commit)=>({root:local,model:'explicit-classification-replay',executor,gate,deadline,skills:null,commit,read_snapshot_body:reference=>manager.readFile(journal.handle,reference.path),read_current_knowledge:async()=>[],gateway:new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],async request=>{fetches.push(request.href);if(request.href!==url)throw new Error('forbidden_supplementary_fetch');return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(html)};})}),prepareResources:async()=>{throw new Error('forbidden_upload');},verifySources:async()=>{throw new Error('unexpected_delivery');},seal:async()=>{throw new Error('forbidden_seal');},publish:async()=>{throw new Error('forbidden_publish');},reconcile:async project=>project};
  const controller=new ReadingController(ports);return {journal,manager,local,controller,run:()=>controller.run(parseDispatch({mode:'scheduled',submission_id:'unlabelled-url',input_urls:[url]}),'fixture-owner'),project:async()=>await journal.load<HostProject>(journal.keys('projects/')[0]!)};
 };
 return {root,url,session,calls,fetches,refusals,presented,cleanup:()=>rm(root,{recursive:true,force:true})};
}
it('a product-name mechanism tutorial and announcement take different persisted routes without a keyword exclusion rule',async()=>{
 const allowed=await fixture('allowed',tutorial),excluded=await fixture('excluded',announcement);try{
  const a=await allowed.session(true),b=await excluded.session(true);await a.run();await b.run();expect(allowed.calls).toEqual(['classify','select']);expect(excluded.calls).toEqual(['classify']);
  expect((await a.project())?.classification?.credential?.content_eligibility).toBe('allowed');expect(await b.project()).toMatchObject({state:'skipped',reason:'semantic_excluded'});expect(b.journal.handle.snapshot.manifest.files.some(file=>file.path.includes('/draft/'))).toBe(false);
  const response=await b.journal.load<{reason_codes:string[]}>('responses/'+b.journal.keys('invocations/')[0]!.split('/')[1]);expect(response?.reason_codes).toEqual(['product_announcement']);
 }finally{await allowed.cleanup();await excluded.cleanup();}
});
it.each(['allowed','excluded','unresolved'] as const)('unlabelled mixed main is presented before %s classification and its route/allowance survives a cold manager',async kind=>{
 const f=await fixture(kind,mixed);try{
  const first=await f.session(true),report=await first.run(),project=(await first.project())!;expect(f.presented.every(text=>text.includes(mixed))).toBe(true);expect(f.fetches).toEqual([f.url]);expect(project.classification?.attempts).toBe(kind==='unresolved'?2:1);
  if(kind==='unresolved'){expect(project).toMatchObject({state:'deferred',resume_policy:'manual',reason:'policy_review_required'});expect(report.blocked_projects).toMatchObject([{project_id:project.project_id,reason:'policy_review_required'}]);expect(f.calls).toEqual(['classify','classify']);}else if(kind==='excluded')expect(f.calls).toEqual(['classify']);else expect(f.calls).toEqual(['classify','select']);
  const before=[...f.calls];await rm(first.local,{recursive:true,force:true});const cold=await f.session();expect((await cold.project())?.classification).toEqual(project.classification);await cold.run();if(kind==='allowed'){expect(f.calls.filter(call=>call==='classify')).toHaveLength(1);expect(f.calls).toEqual([...before,'select']);}else expect(f.calls).toEqual(before);expect(f.fetches).toEqual([f.url]);
  expect(cold.journal.keys('delivery-')).toEqual([]);expect(cold.journal.handle.snapshot.manifest.files.some(file=>file.path.includes('/draft/'))).toBe(false);
 }finally{await f.cleanup();}
});
it('the actual classifier tool table and SDK permission hook deny paper, rendering, note write and publish attempts without effects',async()=>{
 const f=await fixture('unresolved',mixed,'manual',true);try{
  const first=await f.session(true);await first.run();expect(f.refusals).toEqual(['follow_reference','render_diagram','write_note','publish','follow_reference','render_diagram','write_note','publish']);expect(f.fetches).toEqual([f.url]);expect(first.journal.keys('delivery-')).toEqual([]);expect(first.journal.keys('resources/')).toEqual([]);expect(first.journal.handle.snapshot.manifest.files.some(file=>file.role==='artifact'||file.role==='output')).toBe(false);
  const cold=await f.session();await cold.run();expect(f.refusals).toHaveLength(8);expect(f.calls).toEqual(['classify','classify']);
 }finally{await f.cleanup();}
});
it.each(['langchain','claude'] as const)('%s official entry product announcement is skipped with a durable reason before research or delivery',async source=>{
 const f=await fixture('excluded',announcement,source);try{const first=await f.session(true);await first.run();expect(f.calls).toEqual(['classify']);const project=(await first.project())!;expect(project.candidate.origin_source_ids).toContain(source==='langchain'?'langchain_blog':'claude_resources');expect(project.state).toBe('skipped');expect(first.journal.keys('delivery-')).toEqual([]);const reply=await first.journal.load<Classification>('responses/'+first.journal.keys('invocations/')[0]!.split('/')[1]);expect(reply?.reason_codes).toEqual(['product_announcement']);const cold=await f.session();await cold.run();expect(f.calls).toEqual(['classify']);}finally{await f.cleanup();}
});
it('pure marketing has a persisted exclusion reason and no note on the next physical run',async()=>{
 const f=await fixture('excluded',marketing);try{const first=await f.session(true);await first.run();const cold=await f.session();await cold.run();expect(f.calls).toEqual(['classify']);expect(cold.journal.handle.snapshot.manifest.files.some(file=>file.path.includes('/draft/'))).toBe(false);const reply=await cold.journal.load<Classification>('responses/'+cold.journal.keys('invocations/')[0]!.split('/')[1]);expect(reply?.reason_codes).toEqual(['marketing']);expect((await cold.project())?.state).toBe('skipped');}finally{await f.cleanup();}
});

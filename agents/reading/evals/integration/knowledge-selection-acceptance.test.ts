import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {parse,stringify} from 'yaml';
import {buildApplication} from '../../src/app/bootstrap.js';
import type {HostProject} from '../../src/app/controller.js';
import type {WorkspaceJournal} from '../../src/app/journal.js';
import type {QueryRequest,ModelAdapter} from '../../src/runtime/sdk.js';
import {readInstalledSdkVersion} from '../../src/runtime/versions.js';
import {READING_CLOUD_CONTRACT} from '../../src/tools/skills.js';
import {parseDeployment} from '../../src/config/deployment.js';
import {parseDispatch} from '../../src/config/dispatch.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {parseTrustedPolicy,type PolicySnapshot} from '../../src/config/trusted-policy.js';
import {WebSourceAdapter,emptySourceProgress,type SourcePage} from '../../src/collect/sources.js';
import {emptyIdentity,addCandidate,type IdentityState} from '../../src/collect/identity.js';
import {UrlGateway,type GatewayReply} from '../../src/tools/fetch.js';
import type {SourceSlice} from '../../src/tools/segments.js';
import {digest,type Evidence,type ResearchPacket} from '../../src/stages/contracts.js';
import {canonicalJson} from '../../src/contracts/index.js';
import type {Writing} from '../../src/stages/validation.js';
const exec=promisify(execFile);
type Article={url:string;kind?:'announcement';mechanism:string;experiment:string;boundary:string};
const baseArticle=(url:string):Article=>({url,mechanism:'Intent is saved before retrying an agent operation.',experiment:'Experiment on 64 tasks increased successful completion from 40 to 52.',boundary:'Shared state requires a single writer.'});
const recentPath='Organize Notes By AI/260101-reviewed.md';
const updatedPath='Organize Notes By AI/260101-updated.md';
const filenamePath='Organize Notes By AI/261010-filename.md';
const gitPath='Organize Notes By AI/260230-invalid.md';
const oldSource='https://claude.com/resources/articles/historical-announcement';
const style='HISTORICAL_STYLE_REFERENCE';

// All HTTP/model replies are explicit replay. The host, Git note loading, policy,
// source adapters, stage tools, evidence validation and immutable cold restore are real.
async function fixture(options:{disableClaude?:boolean;deferFirstSelection?:boolean}={}){
 const root=await mkdtemp(join(tmpdir(),'knowledge-selection-acceptance-')),notes=join(root,'notes'),local=join(root,'workspace');
 const marker=`<!-- ${READING_CLOUD_CONTRACT.documentation_marker} -->`;
 const files:Record<string,string>={
  '.agents/skills/obsidian-note/SKILL.md':marker+'\nUse VAULT_ROOT, fixed evidence and approved note examples.',
  '.agents/skills/fireworks-tech-graph/SKILL.md':marker+'\nOnly trusted fixed diagrams.',
  '.agents/skills/obsidian-note/references/diagram-playbook.md':marker+'\nUse inline Mermaid or HTML cards when appropriate.',
  '.agents/skills/obsidian-note/references/reading-agent-cloud-contract.json':canonicalJson(READING_CLOUD_CONTRACT),
 };
 const note=(metadata:string)=>`---\ntitle: Agent engineering\ntags: [agent, engineering]\nsource: ${oldSource}\n${metadata}\n---\n# Agent engineering\n${style}\nMechanisms, evidence and explicit limits make a durable note. This historical announcement is a style example, not permission to select new announcements.\n`;
 Object.assign(files,{[recentPath]:note('reviewed_at: 2026-10-13\ncreated: 2020-01-01\npublished: 2000-01-01'),[updatedPath]:note('updated: 2026-10-12\ncreated: 2020-01-01'),[filenamePath]:note('published: 2099-01-01'),[gitPath]:note('published: 2099-01-01')});
 for(const [path,text] of Object.entries(files)){await mkdir(dirname(join(notes,path)),{recursive:true});await writeFile(join(notes,path),text);}
 await exec('git',['init',notes]);await exec('git',['-C',notes,'add','.']);await exec('git',['-C',notes,'-c','user.name=Fixture','-c','user.email=fixture@example.org','commit','-m','Fixed knowledge fixture'],{env:{...process.env,GIT_AUTHOR_DATE:'2020-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2020-01-01T00:00:00Z'}});
 const originalCommit=(await exec('git',['-C',notes,'rev-parse','HEAD'])).stdout.trim();
 const deployment=parseDeployment(JSON.parse(await readFile('agents/reading/deploy/examples/preview.json','utf8')));
 const policyFiles:PolicySnapshot['files']={'preferences.yaml':await readFile('agents/reading/preferences.yaml','utf8'),'sources.yaml':await readFile('agents/reading/sources.yaml','utf8'),'runtime.yaml':await readFile('agents/reading/runtime.yaml','utf8')};
 const runtime=parse(policyFiles['runtime.yaml']);runtime.allowed_domains.push('independent.dev','claude.dev');policyFiles['runtime.yaml']=stringify(runtime);
 if(options.disableClaude){const sources=parse(policyFiles['sources.yaml']);sources.sources.claude_resources.enabled=false;policyFiles['sources.yaml']=stringify(sources);}
 const policySnapshot=()=>({commit:'a'.repeat(40),files:policyFiles}),articles=new Map<string,Article>(),directories=new Map<string,string>(),requests:string[]=[],modelErrors:string[]=[],calls:{stage:string;url:string;project:string;prompt:string}[]=[],reads:{stage:string;url:string;text:string}[]=[],writingExamples:string[]=[],knowledgeViews:{url:string;notes:unknown}[]=[];
 let selections=0,sessions=0;
 const transport=async(url:URL):Promise<GatewayReply>=>{requests.push(url.href);if(directories.has(url.href))return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(directories.get(url.href)!)};const article=articles.get(url.href);if(!article)throw new Error('fixture_url_not_registered');return {status:200,headers:{'content-type':'text/html'},body:Buffer.from(`<html><head><title>Agent engineering</title></head><body><main><h1>Agent engineering</h1><p>${article.mechanism}</p><p>${article.experiment}</p><p>${article.boundary}</p></main></body></html>`)};};
 const open=async()=>{
  let journal:WorkspaceJournal;
  const model:ModelAdapter={async *stream(request:QueryRequest){
   const payload=JSON.parse(request.prompt) as {task:string;data:Record<string,unknown>;context:Record<string,unknown>},classify=Object.hasOwn((request.schema as {properties?:object}).properties??{},'content_eligibility'),stage=classify?'classify':payload.task;
   const project=Object.values(journal.handle.records).find(value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&'pending_query'in value&&value.pending_query!==null) as unknown as HostProject;
   const article=articles.get(project.candidate.url)!;expect(article).toBeDefined();calls.push({stage,url:article.url,project:project.project_id,prompt:request.prompt});
   const call=(name:string,input:Record<string,unknown>={})=>request.tools.find(tool=>tool.name===name)!.run(input);
   const main=async()=>{const view=await call('read_main') as SourceSlice;const text=view.lines.map(line=>line.text).join('\n');reads.push({stage,url:article.url,text});expect(text).toContain(article.mechanism);expect(text).toContain(article.experiment);return view;};
   let result:unknown;
   if(classify){const view=await main(),line=view.lines.find(line=>line.text===article.mechanism)!;expect(payload.context).not.toHaveProperty('example_texts');result={content_eligibility:article.kind==='announcement'?'excluded':'allowed',content_type:article.kind==='announcement'?'product_announcement':'engineering',topic:'agents',reason_codes:article.kind==='announcement'?['product_announcement']:[],evidence:[{start_line:line.line,end_line:line.line,excerpt:article.mechanism}]};}
   else if(stage==='selection'){
    expect(payload.data.main).not.toHaveProperty('text');const view=await main();expect(view.lines.some(line=>line.text===article.experiment)).toBe(true);
    const related=await call('read_related_summary') as {id:string}[];knowledgeViews.push({url:article.url,notes:related});expect(related.length).toBeGreaterThan(0);await call('read_related_note',{id:related[0]!.id});
    // A historical style source never becomes a registered article snapshot.
    await expect(call('read_source',{snapshot_hash:digest('unregistered historical announcement'),source_url:oldSource})).rejects.toThrow();
    const defer=options.deferFirstSelection&&selections++===0;result={decision:defer?'defer':'research',reason_codes:[defer?'cold_context_probe':'new_experimental_evidence'],reason:article.experiment,dimension_ratings:{relevance:'strong',mechanism:'strong',evidence:'strong',transferability:'strong',increment:'strong'},questions:defer?[]:['Mechanism?','Experiment?','Boundary?'],related_note_ids:related.map(note=>note.id),evidence_ids:[]};
   }else if(stage==='research'){
    const view=await main(),snapshot=(payload.data.snapshots as {url:string;hash:string;retrieved_at:string}[])[0]!;
    const questions=[{id:'q1',text:'Mechanism?',priority:'required' as const},{id:'q2',text:'Experiment?',priority:'required' as const},{id:'q3',text:'Boundary?',priority:'required' as const}];await call('plan_research',{questions});
    await expect(call('follow_reference',{from_hash:snapshot.hash,url:oldSource})).rejects.toThrow('reference_not_in_material');
    const evidence:Evidence[]=[article.mechanism,article.experiment,article.boundary].map((text,index)=>{const line=view.lines.find(line=>line.text===text)!;return {evidence_id:'e'+(index+1),source_url:snapshot.url,retrieved_at:snapshot.retrieved_at,snapshot_hash:snapshot.hash,locator:{start_line:line.line,end_line:line.line},excerpt:text,claim:text,claim_type:'source_statement',limits:[],based_on:[]};});
    for(const item of evidence)await call('record_evidence',{evidence:item});
    const packet:ResearchPacket={project_id:project.project_id,questions,answers:evidence.map((item,index)=>({question_id:'q'+(index+1),answer:item.claim,evidence_ids:[item.evidence_id],source_not_provided:false})),evidence,gaps:[],source_versions:[{url:snapshot.url,hash:snapshot.hash,main:true,core:true,status:'read'}],mechanism_evidence_ids:['e1'],boundary_evidence_ids:['e3'],knowledge_increment:article.experiment};result=packet;
   }else if(stage==='writing'){
    await call('activate_skill',{name:'obsidian-note'});await call('read_skill_resource',{name:'obsidian-note',path:'references/diagram-playbook.md'});
    const examples=payload.context.example_texts as Record<string,string>;expect(Object.values(examples).join('\n')).toContain(style);writingExamples.push(canonicalJson(examples));
    const date=String(payload.data.created),title='实验'+digest(article.url).slice(0,6),markdown=`---\ntitle: ${title}\ntags: [agent, engineering, experiment]\ncreated: ${date}\nsource: ${article.url}\n---\n# ${title}\n\n> [!abstract] 摘要\n> 机制、实验条件与边界。
\n## 一、机制\n${article.mechanism}\n\n\`\`\`mermaid\nflowchart LR\n Intent[意图] --> Effect[执行]\n\`\`\`\n\n## 二、实验\n${article.experiment}\n<div>实验结果与条件</div>\n\n## 三、边界\n${article.boundary}\n<div>单写入者边界</div>\n`,line=(text:string)=>markdown.split('\n').indexOf(text)+1;
    const writing:Writing={note_path:`Organize Notes By AI/${date.slice(2).replaceAll('-','')}-${title}.md`,markdown,claims:[article.mechanism,article.experiment,article.boundary].map((text,index)=>({id:'c'+(index+1),text,line:line(text),evidence_ids:['e'+(index+1)],claim_type:'source_statement'})),figure_plan:[{section:'一、机制',type:'mermaid',goal:'Intent',resource_path:null,no_figure_reason:null},{section:'二、实验',type:'html_card',goal:'Results',resource_path:null,no_figure_reason:null},{section:'三、边界',type:'html_card',goal:'Boundary',resource_path:null,no_figure_reason:null}],resources:[],degradations:[]};result=writing;
   }else{expect(stage).toBe('review');result={issues:[],file_hashes:payload.data.file_hashes,resource_manifest_hash:payload.data.resource_manifest_hash};}
   yield {message_id:'knowledge-result-'+calls.length,type:'result',summary:true,success:true,result,usage:{input_tokens:3,output_tokens:1,cost_status:'unknown',cost_usd:null},observable:{}};
  }};
  const app=await buildApplication({deployment,dispatch:parseDispatch({mode:'preview',preview_id:'knowledge-selection',input_urls:[]}),notes_repository:notes,local_root:local,local:true,run_id:'knowledge-selection-'+(++sessions),env:{},policy_source:{readSnapshot:async()=>policySnapshot()},model_adapter:{async *stream(request){try{yield*model.stream(request);}catch(error){modelErrors.push(error instanceof Error?error.message:String(error));throw error;}}},runtime_versions_provider:async()=>({...await readInstalledSdkVersion(),tools_image_id:'sha256:'+'0'.repeat(64),tools_manifest_hash:'0'.repeat(64)}),gateway_resolver:async()=>[{address:'8.8.8.8',family:4}],gateway_transport:transport});journal=app.journal;
  const gate=new PolicyGate(async()=>parseTrustedPolicy(policySnapshot()),check=>journal.commit('policy-checks/'+check.check_id,check));
  const collect=async(source:'claude_resources'|'langchain_blog',directory:string)=>{
   const policy=parseTrustedPolicy(policySnapshot()),gateway=new UrlGateway(async url=>{await gate.require({subject_ref:'source:'+source,execution_scope:'preview',origin_source_ids:[source],urls:[url]},'discover','knowledge_fixture_source_request');},async()=>[{address:'8.8.8.8',family:4}],transport);
   const adapter=new WebSourceAdapter({source_id:source,entry_url:directory,enabled:policy.sources[source]!.enabled,window_days:7,batch_size:50},async url=>{const read=await gateway.read(url);return {url:read.url,body:Buffer.from(read.bytes).toString()};});return adapter.collect(emptySourceProgress(),new Date());
  };
  const seed=async(page:SourcePage)=>{const identity=await journal.load<IdentityState>('identity')??emptyIdentity();for(const candidate of page.candidates)addCandidate(identity,candidate);await journal.commitMany({identity},'source_candidate_fixture_page');};
  return {app,journal,gate,collect,seed,run:(urls:string[]=[])=>app.controller.run(parseDispatch({mode:'preview',preview_id:'knowledge-selection',input_urls:urls}),'fixture-owner'),projects:async()=>Promise.all(journal.keys('projects/').map(key=>journal.load<HostProject>(key))),coldRemove:async()=>{await exec('chmod',['-R','u+rwX',local]);await rm(join(local,'restored'),{recursive:true,force:true});}};
 };
 return {root,notes,local,files,originalCommit,articles,directories,requests,calls,reads,writingExamples,knowledgeViews,modelErrors,open,cleanup:async()=>{await exec('chmod',['-R','u+rwX',root]);await rm(root,{recursive:true,force:true});}};
}

it('Claude cards alone discover an allowed external official main; actual Gate and driver read its body while navigation links never become candidates',async()=>{
 const f=await fixture();try{
  const article=baseArticle('https://claude.dev/official/agent-mechanism');f.articles.set(article.url,article);const directory='https://claude.com/resources';
  f.directories.set(directory,`<nav><a href="https://claude.dev/navigation-only">Navigation</a><a href="https://other.dev/untrusted">Other navigation</a></nav><a class="ResourceCard" href="${article.url}"><h3>Agent engineering</h3></a>`);
  const first=await f.open(),page=await first.collect('claude_resources',directory);expect(page.candidates.map(candidate=>candidate.url)).toEqual([article.url]);expect(page.candidates[0]!.origin_source_ids).toEqual(['claude_resources']);await first.seed(page);await first.run();
  const project=(await first.projects())[0]!;expect(project?.state,f.modelErrors.join(',')).toBe('preview_ready');expect(f.requests).toEqual([directory,article.url]);expect(f.reads.find(read=>read.stage==='selection')?.text).toContain(article.experiment);expect(project?.research?.source_versions).toMatchObject([{url:article.url,status:'read'}]);
  const checks=first.journal.keys('policy-checks/').map(key=>first.journal.handle.records[key] as {requested_capability?:string;execution_permission?:string;checkpoint?:string});expect(checks.some(check=>check.requested_capability==='main_read'&&check.execution_permission==='allowed')).toBe(true);
  const cold=await f.open();await cold.run();expect(cold.journal.keys('projects/')).toHaveLength(1);expect(f.calls).toHaveLength(5);expect(f.requests).toEqual([directory,article.url]);
 }finally{await f.cleanup();}
},60_000);

it('multiple Git-loaded related notes sort by organization date and retain exact date basis, commit and example bytes across a changed checkout and cold continuation',async()=>{
 const f=await fixture({deferFirstSelection:true});try{
  const article=baseArticle('https://independent.dev/agent/engineering/context');f.articles.set(article.url,article);const first=await f.open();await first.run([article.url]);const original=(await first.projects())[0]!;expect(original?.reason,f.modelErrors.join(',')).toBe('cold_context_probe');
  const expected=[recentPath,updatedPath,filenamePath,gitPath];expect(original!.context.related_notes.map(note=>note.path)).toEqual(expected);expect(original!.context.examples.map(note=>note.path)).toEqual(expected.slice(0,3));
  expect(original!.context.related_notes.map(note=>[note.date_basis,note.organized_at])).toEqual([['reviewed_at','2026-10-13T00:00:00.000Z'],['updated','2026-10-12T00:00:00.000Z'],['filename_YYMMDD','2026-10-10T00:00:00.000Z'],['first_added_git','2020-01-01T00:00:00.000Z']]);
  for(const note of original!.context.related_notes){expect(note.commit).toBe(f.originalCommit);expect(note.hash).toBe(digest((await exec('git',['-C',f.notes,'show',`${f.originalCommit}:${note.path}`])).stdout));}
  const oldContext=canonicalJson(original!.context);await writeFile(join(f.notes,recentPath),f.files[recentPath]!.replace('reviewed_at: 2026-10-13','reviewed_at: 2027-01-01').replace(style,'LATEST_CHECKOUT_TEXT'));await exec('git',['-C',f.notes,'add','.']);await exec('git',['-C',f.notes,'-c','user.name=Fixture','-c','user.email=fixture@example.org','commit','-m','Change current notes']);await first.coldRemove();
  expect((await exec('git',['-C',f.notes,'rev-parse','HEAD'])).stdout.trim()).not.toBe(f.originalCommit);
  const cold=await f.open();expect(canonicalJson((await cold.projects())[0]!.context)).toBe(oldContext);await cold.run();const completed=(await cold.projects())[0]!;expect(completed?.state,f.modelErrors.join(',')).toBe('preview_ready');expect(canonicalJson(completed!.context)).toBe(oldContext);expect(f.writingExamples).toHaveLength(1);expect(f.writingExamples[0]).toBe(canonicalJson(original!.context.example_texts));expect(f.writingExamples[0]).not.toContain('LATEST_CHECKOUT_TEXT');expect(f.calls.map(call=>call.stage)).toEqual(['classify','selection','selection','research','writing','review']);
 }finally{await f.cleanup();}
},60_000);

it('excluded and disabled-source historical notes are writing references only; announcements remain excluded, disabled discovery is denied and no historical URL is fetched',async()=>{
 const f=await fixture({disableClaude:true});try{
  const allowed=baseArticle('https://independent.dev/agent-allowed'),announcement={...baseArticle('https://independent.dev/agent-announcement'),kind:'announcement' as const,mechanism:'We are launching a new agent product today.'};f.articles.set(allowed.url,allowed);f.articles.set(announcement.url,announcement);
  const first=await f.open();await first.run([allowed.url,announcement.url]);const projects=(await first.projects()) as HostProject[];expect(projects.find(project=>project.candidate.url===allowed.url)?.state,f.modelErrors.join(',')).toBe('preview_ready');expect(projects.find(project=>project.candidate.url===announcement.url)).toMatchObject({state:'skipped',reason:'semantic_excluded'});expect(f.calls.filter(call=>call.url===announcement.url).map(call=>call.stage)).toEqual(['classify']);expect(f.writingExamples[0]).toContain(style);expect(f.writingExamples[0]).toContain(oldSource);
  const page=await first.collect('claude_resources','https://claude.com/resources');expect(page.result.status).toBe('disabled');expect(page.candidates).toEqual([]);
  await expect(first.gate.require({subject_ref:'source:claude_resources',execution_scope:'preview',origin_source_ids:['claude_resources'],urls:['https://claude.com/resources']},'discover','disabled_style_source')).rejects.toThrow('source_disabled');
  expect(f.requests.sort()).toEqual([allowed.url,announcement.url].sort());expect(first.journal.keys('delivery-')).toEqual([]);
  const identity=(await first.journal.load<IdentityState>('identity'))!;expect(Object.values(identity.candidates).map(candidate=>candidate.url).sort()).toEqual([allowed.url,announcement.url].sort());const before=f.calls.length;await first.coldRemove();const cold=await f.open();await cold.run();expect(f.calls).toHaveLength(before);expect(f.requests).not.toContain(oldSource);
 }finally{await f.cleanup();}
},60_000);

it.each(['empty','short'] as const)('%s discovery summary lacks mechanism, but actual full-body presentation supplies evidence before selection and research',async summary=>{
 const f=await fixture();try{
  const article=baseArticle('https://www.langchain.com/blog/agent-'+summary);f.articles.set(article.url,article);const directory='https://www.langchain.com/blog';f.directories.set(directory,`<div class="blog-list is-normal"><div class="blog-item"><a class="blog-link-absolute" href="${article.url}"></a><h3>${summary==='empty'?'':'Agent overview'}</h3><p>${summary==='empty'?'':'A short overview.'}</p></div></div>`);
  const first=await f.open(),page=await first.collect('langchain_blog',directory);expect(page.candidates).toHaveLength(1);expect(page.candidates[0]!.title).toBe(summary==='empty'?null:'Agent overview');expect(canonicalJson(page.candidates)).not.toContain(article.experiment);await first.seed(page);await first.run();const project=(await first.projects())[0]!;
  expect(project?.state,f.modelErrors.join(',')).toBe('preview_ready');expect(project?.selection?.decision).toBe('research');expect(f.reads.filter(read=>read.stage==='selection'||read.stage==='research').every(read=>read.text.includes(article.experiment))).toBe(true);expect(project?.research?.evidence.map(evidence=>evidence.excerpt)).toContain(article.experiment);expect(project?.research?.knowledge_increment).toBe(article.experiment);
  const cold=await f.open();expect((await cold.projects())[0]?.research).toEqual(project?.research);await cold.run();expect(f.calls).toHaveLength(5);expect(f.requests).toEqual([directory,article.url]);
 }finally{await f.cleanup();}
},60_000);

it('same-topic articles with different experiments and opposite conclusions both survive selection and persist distinct evidence and knowledge increments across cold restore',async()=>{
 const f=await fixture();try{
  const positive=baseArticle('https://independent.dev/papers/a001'),negative={...baseArticle('https://independent.dev/papers/a002'),experiment:'Experiment on 64 tasks reduced successful completion from 52 to 40 under shared-state races.'};f.articles.set(positive.url,positive);f.articles.set(negative.url,negative);const first=await f.open();await first.run([positive.url,negative.url]);const projects=(await first.projects()) as HostProject[];
  expect(projects).toHaveLength(2);expect(projects.every(project=>project.state==='preview_ready'),f.modelErrors.join(',')).toBe(true);expect(projects.every(project=>project.selection?.decision==='research')).toBe(true);expect(new Set(projects.map(project=>project.snapshots[0]!.hash)).size).toBe(2);
  for(const article of [positive,negative]){const project=projects.find(project=>project.candidate.url===article.url)!;expect(f.calls.filter(call=>call.url===article.url).map(call=>call.stage)).toEqual(['classify','selection','research','writing','review']);expect(project.selection?.reason).toBe(article.experiment);expect(project.research?.knowledge_increment).toBe(article.experiment);expect(project.research?.evidence).toMatchObject([{claim:article.mechanism},{claim:article.experiment},{claim:article.boundary}]);expect(project.research?.answers[1]?.answer).toBe(article.experiment);expect(project.writing?.markdown).toContain(article.experiment);}
  expect(f.knowledgeViews).toHaveLength(2);expect(f.knowledgeViews.every(view=>JSON.stringify(view.notes).includes('Agent engineering'))).toBe(true);
  // The opposing result reaches selection after the positive result is actual
  // recalled knowledge, so this is more than two unrelated URL identities.
  expect(JSON.stringify(f.knowledgeViews.find(view=>view.url===negative.url)!.notes)).toContain(positive.experiment);
  const identity=(await first.journal.load<IdentityState>('identity'))!;expect(Object.values(identity.candidates)).toHaveLength(2);expect(Object.keys(identity.content)).toHaveLength(2);
  await first.coldRemove();const cold=await f.open();for(const project of projects)expect(await cold.journal.load('projects/'+project.project_id)).toEqual(project);await cold.run();expect(f.calls).toHaveLength(10);expect(f.requests.sort()).toEqual([positive.url,negative.url].sort());
 }finally{await f.cleanup();}
},60_000);

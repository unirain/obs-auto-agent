import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal,ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController,type ControllerPorts,type HostProject} from '../../src/app/controller.js';
import {mappedState,decodeDelivery} from '../../src/app/bootstrap.js';
import {PolicyGate,credentialValid} from '../../src/policy/gate.js';
import {policyFixture} from '../runtime/policy-fixtures.js';
import {buildContext} from '../../src/context/index.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {UrlGateway,extractWebSnapshot,type GatewayReply} from '../../src/tools/fetch.js';
import {digest,type Evidence,type ResearchPacket} from '../../src/stages/contracts.js';
import {newRuntimeProject} from '../../src/stages/driver.js';
import type {QueryRequest,ModelAdapter} from '../../src/runtime/sdk.js';
import type {SourceSlice} from '../../src/tools/segments.js';
import {emptySourceProgress,WebSourceAdapter,type SourceProgress} from '../../src/collect/sources.js';
import {intakeManual} from '../../src/collect/intake.js';
import {emptyIdentity,discoverCandidate,addCandidate,type IdentityState} from '../../src/collect/identity.js';
import {parseDispatch} from '../../src/config/dispatch.js';
import {canonicalJson,AgentError} from '../../src/contracts/index.js';
import {CLOUD_CONTRACT_PATH,READING_CLOUD_CONTRACT,cloudSkillAdapted} from '../../src/tools/skills.js';
import {Publisher} from '../../src/publish/publisher.js';
import {deliveryValidationHash} from '../../src/publish/validate.js';
import {sealDelivery,verifySeal,type ArtifactSeal} from '../../src/workspace/seal.js';
import type {SealedDelivery,PermissionCheck} from '../../src/publish/types.js';
import {FakeGitHub} from '../delivery/helpers.js';
import {capacityView,assertCapacity} from '../../src/storage/capacity.js';

// Historical PRs and model/HTTP responses are explicit local fixtures. Admission,
// redirect security, driver, immutable state, seal and new PR publication are real code.
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'intake-identity-acceptance-')),store=new FileObjectStore(join(root,'objects'));
 const workspace='obs-notes-hub/reading',policy=policyFixture();policy.allowed_domains.push('independent.dev');
 const manual='https://independent.dev/archive/redirect',final='https://www.langchain.com/blog/intent-ordering';
 const mechanism='Mechanism writes intent before an operation.',boundary='Only a single writer is supported.';
 const publication='2020-01-02T00:00:00Z';
 const article=(url:string)=>`<html><head><title>Journal mechanism ${new URL(url).pathname}</title></head><body><main><h1>Journal ${new URL(url).pathname}</h1><p><time datetime="${publication}">2020-01-02</time></p><p>${mechanism}</p><p>${boundary}</p></main></body></html>`;
 const templates=Object.fromEntries(await Promise.all(['selection','research','writing','review'].map(async stage=>[stage,await readFile(`agents/reading/prompts/${stage}.md`,'utf8')])));
 const marker=`<!-- ${READING_CLOUD_CONTRACT.documentation_marker} -->`,skillFiles:Record<string,string>={'.agents/skills/obsidian-note/SKILL.md':marker+'\nUse VAULT_ROOT for fixed evidence notes.','.agents/skills/obsidian-note/references/diagram-playbook.md':marker+'\nInline Mermaid and HTML cards are allowed.','.agents/skills/fireworks-tech-graph/SKILL.md':marker+'\nFixed tools only.',[CLOUD_CONTRACT_PATH]:canonicalJson(READING_CLOUD_CONTRACT)};
 const hashes=Object.fromEntries(Object.entries(skillFiles).map(([path,text])=>[path,digest(text)]));
 const remotes=new Map<string,FakeGitHub>(),calls:{stage:string;project:string;source:string}[]=[],requests:string[]=[],modelErrors:string[]=[];
 let sessions=0,capacityStopped=false,expired=false,selectionOnly=false;
 const context=()=>buildContext({index:[],query:'intent ordering',heldout:{urls:new Set(),note_paths:new Set()},preferences_hash:digest('preferences'),skill_commit:'a'.repeat(40),skill_hash:digest(canonicalJson(hashes)),prompt_hash:digest(Buffer.concat(['selection','research','writing','review'].map(stage=>Buffer.from(templates[stage]!)))),prompt_templates:templates,model:'intake-identity-model-replay',evidence_versions:[]});
 const session=async(initialize=false)=>{
  const local=join(root,'cold-'+(++sessions)),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:local,record_validator:validateHostRecords}),journal=new WorkspaceJournal(manager,await manager.restore(workspace,{allow_initialize:initialize}),'intake-identity-run-'+sessions);
  const gate=new PolicyGate(async()=>policy,check=>journal.commit('policy-checks/'+check.check_id,check)),deadline=new RunDeadline();
  for(const [path,text] of Object.entries(skillFiles)){await mkdir(dirname(join(local,path)),{recursive:true});await writeFile(join(local,path),text);}
  const model:ModelAdapter={preflight:async()=>{if(capacityStopped){try{assertCapacity(capacityView([{bucket:'readonly-fixture-images',key:'retained-image',size:49_100_000_000,created_at:'2026-10-01T00:00:00Z'}],[]),1024,'generation');}catch(error){if(error instanceof AgentError&&error.code==='capacity')throw new Error('storage_capacity');throw error;}}},async *stream(request:QueryRequest){
   const payload=JSON.parse(request.prompt) as {task:string;data:Record<string,unknown>},classify=Object.hasOwn((request.schema as {properties?:object}).properties??{},'content_eligibility');
   const project=Object.values(journal.handle.records).find(row=>!!row&&typeof row==='object'&&!Array.isArray(row)&&'pending_query' in row&&row.pending_query!==null) as unknown as HostProject;
   expect(project).toBeDefined();const stage=classify?'classify':payload.task;calls.push({stage,project:project.project_id,source:project.candidate.url});
   const call=(name:string,input:Record<string,unknown>={})=>request.tools.find(tool=>tool.name===name)!.run(input);let result:unknown;
   if(classify){const view=await call('read_main') as SourceSlice,line=view.lines.find(line=>line.text===mechanism)!;result={content_eligibility:'allowed',content_type:'engineering',topic:'agents',reason_codes:[],evidence:[{start_line:line.line,end_line:line.line,excerpt:mechanism}]};}
   else if(stage==='selection'){await call('read_main');result={decision:selectionOnly?'defer':'research',reason_codes:[selectionOnly?'selection_reached':'new_failure_mechanism'],reason:'The protocol adds recovery evidence.',dimension_ratings:{relevance:'strong',mechanism:'strong',evidence:'strong',transferability:'strong',increment:'strong'},questions:selectionOnly?[]:['Mechanism?','Boundary?','Independent experiment?'],related_note_ids:[],evidence_ids:[]};}
   else if(stage==='research'){
    const view=await call('read_main') as SourceSlice,snapshot=(payload.data.snapshots as {url:string;hash:string;retrieved_at:string}[])[0]!;
    const questions=[{id:'q1',text:'Mechanism?',priority:'required' as const},{id:'q2',text:'Boundary?',priority:'required' as const},{id:'q3',text:'Independent experiment?',priority:'required' as const}];await call('plan_research',{questions});
    const evidence:Evidence[]=[mechanism,boundary].map((text,index)=>{const line=view.lines.find(line=>line.text===text)!;return {evidence_id:'e'+(index+1),source_url:snapshot.url,retrieved_at:snapshot.retrieved_at,snapshot_hash:snapshot.hash,locator:{start_line:line.line,end_line:line.line},excerpt:text,claim:text,claim_type:'source_statement',limits:[],based_on:[]};});
    for(const item of evidence)await call('record_evidence',{evidence:item});
    const packet:ResearchPacket={project_id:project.project_id,questions,answers:[{question_id:'q1',answer:mechanism,evidence_ids:['e1'],source_not_provided:false},{question_id:'q2',answer:boundary,evidence_ids:['e2'],source_not_provided:false},{question_id:'q3',answer:null,evidence_ids:[],source_not_provided:true}],evidence,gaps:[],source_versions:[{url:snapshot.url,hash:snapshot.hash,main:true,core:true,status:'read'}],mechanism_evidence_ids:['e1'],boundary_evidence_ids:['e2'],knowledge_increment:'Durable intent before effects'};result=packet;
   }else if(stage==='writing'){
    await call('activate_skill',{name:'obsidian-note'});await call('read_skill_resource',{name:'obsidian-note',path:'references/diagram-playbook.md'});
    const date=String(payload.data.created),title='日志'+digest(project.candidate.url).slice(0,6),markdown=`---\ntitle: ${title}\ntags: [agents, engineering, recovery]\ncreated: ${date}\nsource: ${project.candidate.url}\n---\n# ${title}\n\n> [!abstract] 摘要\n> 故障后根据持久意图恢复。\n\n## 一、机制\n${mechanism}\n\n\`\`\`mermaid\nflowchart LR\n Intent[保存意图] --> Effect[执行操作]\n\`\`\`\n\n## 二、边界\n${boundary}\n<div>单写入者控制副作用</div>\n`,line=(text:string)=>markdown.split('\n').indexOf(text)+1;
    result={note_path:`Organize Notes By AI/${date.slice(2).replaceAll('-','')}-${title}.md`,markdown,claims:[{id:'c1',text:mechanism,line:line(mechanism),evidence_ids:['e1'],claim_type:'source_statement'},{id:'c2',text:boundary,line:line(boundary),evidence_ids:['e2'],claim_type:'source_statement'}],figure_plan:[{section:'一、机制',type:'mermaid',goal:'Intent ordering',resource_path:null,no_figure_reason:null},{section:'二、边界',type:'html_card',goal:'Writer boundary',resource_path:null,no_figure_reason:null}],resources:[],degradations:[]};
   }else{expect(stage).toBe('review');expect(request.tools).toEqual([]);result={issues:[],file_hashes:payload.data.file_hashes,resource_manifest_hash:payload.data.resource_manifest_hash};}
   yield {message_id:'model-result-'+calls.length,type:'result',summary:true,success:true,result,usage:{input_tokens:3,output_tokens:1,cost_status:'unknown',cost_usd:null},observable:{}};
  }};
  const executor=new StageExecutor({preflight:()=>model.preflight!(),async *stream(request){try{yield* model.stream(request);}catch(error){modelErrors.push(error instanceof Error?error.message:String(error));throw error;}}},gate,new ApplicationInvocationJournal(journal));
  const gateway=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],async(url):Promise<GatewayReply>=>{requests.push(url.href);return url.href===manual?{status:302,headers:{location:final},body:Buffer.from('redirect')}:{status:200,headers:{'content-type':'text/html'},body:Buffer.from(article(url.href))};});
  const remoteFor=(id:string)=>{let remote=remotes.get(id);if(!remote){remote=new FakeGitHub();remotes.set(id,remote);}return remote;};
  const permission:PermissionCheck=async(_capability,id)=>{const project=(await journal.load<HostProject>('projects/'+id))!;return gate.require({subject_ref:'project:'+id,project_id:id,candidate_id:project.candidate.candidate_id,execution_scope:'production',origin_source_ids:project.candidate.origin_source_ids,urls:[project.candidate.url],main_url:project.candidate.url,source_snapshot_hash:project.classification!.source_snapshot_hash,classification:project.classification!.credential!},'publish','local_publisher_write');};
  const delivery=async(project:HostProject)=>decodeDelivery((await journal.load<Parameters<typeof decodeDelivery>[0]>('pending-delivery/'+project.delivery_id))!);
  const publisher=(project:HostProject)=>new Publisher(remoteFor(project.project_id),journal,permission,{workspace_id:workspace,committedRevision:async()=>journal.handle.revision,identity:{name:'Local replay',email:'replay@example.org'},classificationCurrent:async()=>{const check=await gate.current();return credentialValid({subject_ref:'project:'+project.project_id,project_id:project.project_id,candidate_id:project.candidate.candidate_id,execution_scope:'production',origin_source_ids:project.candidate.origin_source_ids,urls:[project.candidate.url],main_url:project.candidate.url,source_snapshot_hash:project.classification!.source_snapshot_hash,classification:project.classification!.credential!},check);},verifyCommittedDelivery:async d=>{const seal=(await journal.load<ArtifactSeal>('artifact-seals/'+d.delivery_id))!;await verifySeal(await manager.restoreRevision(workspace,d.workspace_revision),seal);for(const file of d.files)expect(seal.files.find(item=>item.path===`projects/${d.project_id}/draft/${file.path}`)?.sha256).toBe(file.sha256);}});
  const ports:ControllerPorts={journal,gate,deadline,sources:[],readArtifact:path=>manager.readFile(journal.handle,path),context:async()=>{const value=context();if(!await journal.load('contexts/'+value.context_id))await journal.commitMany({['contexts/'+value.context_id]:value},'generation_context_fixed');return value;},environment:async(_project,commit)=>({root:local,model:'intake-identity-model-replay',executor,gate,gateway,deadline:expired?new RunDeadline(Date.now()-3_600_000):deadline,skills:{root:local,commit:'a'.repeat(40),hash:digest(canonicalJson(hashes)),files:hashes,adapted:cloudSkillAdapted(skillFiles)},commit,read_snapshot_body:reference=>manager.readFile(journal.handle,reference.path),read_current_knowledge:async()=>[]}),prepareResources:async project=>{expect(project.writing!.resources).toEqual([]);return project;},verifySources:async project=>{const primary=project.snapshots[0]!,read=await gateway.read(primary.requested_url??primary.url),snapshot=extractWebSnapshot(read.url,Buffer.from(read.bytes).toString(),new Date().toISOString());expect(snapshot.hash).toBe(primary.hash);return new Date().toISOString();},seal:async project=>{
   const seal=await sealDelivery(journal.handle,project.project_id,{review_passed:true,program_checks_passed:true,input_revision:journal.handle.revision,resources:[]}),content=Buffer.from(project.writing!.markdown);
   const d:SealedDelivery={schema_version:1,delivery_id:project.delivery_id!,execution_scope:'production',workspace_id:workspace,project_id:project.project_id,generation_version:1,workspace_revision:seal.workspace_revision,context_id:project.context.context_id,base_commit:'b'.repeat(40),sources_verified_at:project.sources_verified_at!,files:[{path:project.writing!.note_path,role:'note',mime:'text/markdown',bytes:content.length,sha256:digest(content),content}],resources:[],sources:[project.snapshots[0]!.url],primary_source_aliases:project.candidate.aliases,quality_report:{passed:true,replay:true},rationale:project.selection!.reason,knowledge_increment:project.research!.knowledge_increment,gaps:[],image_degradations:[],usage:{status:'unknown',estimated_usd:null},warnings:[],validated_hash:''};d.validated_hash=deliveryValidationHash(d);
   const encoded={...d,files:d.files.map(({content,...file})=>({...file,content_base64:Buffer.from(content).toString('base64')}))};await journal.commitMany({['pending-delivery/'+d.delivery_id]:encoded,['artifact-seals/'+d.delivery_id]:seal},'local_seal_committed');
  },publish:async project=>mappedState(project,await publisher(project).publish(await delivery(project))),reconcile:async project=>{if(project.project_id.startsWith('seed_')){expect(remoteFor(project.project_id).pr).toMatchObject({number:project.candidate.pr_number,state:'open'});return project;}return mappedState(project,(await publisher(project).reconcile(await delivery(project)))[0]!);}};
  const run=(urls:string[]=[],sources:WebSourceAdapter[]=[])=>new ReadingController({...ports,sources}).run(parseDispatch({mode:'scheduled',input_urls:urls}),'fixture-owner');
  const intake=(url:string,id='manual-request')=>intakeManual({read:async()=>await journal.load<IdentityState>('identity')??emptyIdentity(),commit:(identity,reason)=>journal.commitMany({identity},reason)},gate,{submission_id:id,urls:[url],submitted_by:'fixture-owner',submitted_at:new Date().toISOString(),execution_scope:'production'});
  return {local,manager,journal,ports,run,intake,closeLocal:()=>rm(local,{recursive:true,force:true})};
 };
 return {root,store,workspace,manual,final,publication,policy,remotes,calls,requests,modelErrors,article,context,session,stopCapacity:(value:boolean)=>{capacityStopped=value;},expire:(value:boolean)=>{expired=value;},selectOnly:(value:boolean)=>{selectionOnly=value;},cleanup:()=>rm(root,{recursive:true,force:true})};
}

it('dated manual input outside the first sources bypasses only the seven-day discovery window and reaches real production selection without moving subscription cursors',async()=>{
 const f=await fixture();try{
  f.selectOnly(true);const first=await f.session(true),url='https://independent.dev/archive/old-mechanism';
  const cursor:SourceProgress={...emptySourceProgress(),active:{page_url:'https://www.langchain.com/blog?page=2',offset:3,page_hash:digest('page'),seen_pages:['https://www.langchain.com/blog'],window_start:'2026-10-07T00:00:00Z',started_at:'2026-10-14T00:00:00Z'},observed_ids:[digest('existing source item')]};
  await first.journal.commit('sources/langchain_blog/progress',cursor);
  const receipt=await first.intake(url);expect(receipt.items[0]!.status).toBe('queued');
  const identity=(await first.journal.load<IdentityState>('identity'))!,candidate=identity.candidates[receipt.items[0]!.candidate_id!]!;
  // The fixture's article time is a known source observation, recorded before execution.
  expect(f.article(url)).toContain(`datetime="${f.publication}"`);candidate.published_at=f.publication;await first.journal.commit('identity',identity);
  const report=await first.run([url]);expect(report.mode).toBe('scheduled');expect(Date.parse(candidate.published_at)).toBeLessThan(Date.now()-7*86_400_000);
  const project=(await first.journal.load<HostProject>(first.journal.keys('projects/')[0]!))!;
  expect(project).toMatchObject({execution_scope:'production',state:'deferred',reason:'selection_reached',candidate:{published_at:f.publication,origin_source_ids:['manual_url']}});
  expect(f.calls.map(call=>call.stage),f.modelErrors.join(',')).toEqual(['classify','selection']);expect(f.requests).toEqual([url]);
  expect(await first.journal.load('sources/langchain_blog/progress')).toEqual(cursor);
  await first.closeLocal();const cold=await f.session();expect(await cold.journal.load('sources/langchain_blog/progress')).toEqual(cursor);expect((await cold.journal.load<IdentityState>('identity'))!.candidates[candidate.candidate_id]!.published_at).toBe(f.publication);
  expect((await cold.intake(url)).items[0]).toMatchObject({status:'queued',candidate_status:'deferred',project_id:project.project_id});expect(cold.journal.keys('projects/')).toHaveLength(1);
 }finally{await f.cleanup();}
},60_000);

it('actual redirect then subscription discovery merges all provenance into one durable project and one FakePR across cold runs',async()=>{
 const f=await fixture();try{
  const first=await f.session(true);await first.intake(f.manual);await first.run();
  const project=(await first.journal.load<HostProject>(first.journal.keys('projects/')[0]!))!;expect(project.state,f.modelErrors.join(',')).toBe('pr_open');
  expect(project.snapshots[0]).toMatchObject({url:f.final,requested_url:f.manual});expect(f.requests.slice(0,2)).toEqual([f.manual,f.final]);
  expect(f.remotes.get(project.project_id)!.calls.filter(call=>call==='pr')).toHaveLength(1);
  const invocations=first.journal.keys('invocations/');expect(invocations).toHaveLength(5);await first.closeLocal();
  const cold=await f.session();let pageReads=0;const source=new WebSourceAdapter({source_id:'langchain_blog',entry_url:'https://www.langchain.com/blog',enabled:true,window_days:7,batch_size:50},async url=>{pageReads++;return {url,body:`<div class="blog-list is-normal"><div class="blog-item"><a class="blog-link-absolute" href="${f.final}"></a><h3>Journal mechanism</h3></div></div>`};});
  await cold.run([f.manual+'?utm_source=another-manual'],[source]);
  const identity=(await cold.journal.load<IdentityState>('identity'))!,survivor=identity.candidates[project.candidate.candidate_id]!;
  expect(pageReads).toBe(1);expect(Object.values(identity.candidates)).toHaveLength(1);expect(survivor.origin_source_ids.sort()).toEqual(['langchain_blog','manual_url']);expect(survivor.submission_refs).toHaveLength(2);
  expect(survivor.aliases).toEqual(expect.arrayContaining([f.manual,f.final]));expect(identity.aliases[f.manual]).toBe(survivor.candidate_id);expect(identity.aliases[f.final]).toBe(survivor.candidate_id);expect(identity.content[project.snapshots[0]!.hash]).toBe(survivor.candidate_id);
  expect(cold.journal.keys('projects/')).toEqual([`projects/${project.project_id}`]);expect(await cold.journal.load('projects/'+project.project_id)).toMatchObject({state:'pr_open',candidate:{pr_number:1}});
  expect(cold.journal.keys('invocations/')).toEqual(invocations);expect(f.calls).toHaveLength(5);expect(f.remotes.get(project.project_id)!.calls.filter(call=>call==='pr')).toHaveLength(1);
  const finalCold=await f.session();expect((await finalCold.intake(f.final,'canonical-manual')).items[0]).toMatchObject({status:'already_known',project_id:project.project_id,pr_number:1});expect(finalCold.journal.keys('projects/')).toHaveLength(1);
 }finally{await f.cleanup();}
},60_000);

async function seedPendingHistory(f:Awaited<ReturnType<typeof fixture>>,s:Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['session']>>){
 const ctx=f.context(),identity=emptyIdentity();await s.journal.commitMany({['contexts/'+ctx.context_id]:ctx},'generation_context_fixed');
 // Seed the explicitly known historical scenario through legal host transitions;
 // no fictitious SDK receipts or charges are manufactured for fixture history.
 for(let index=0;index<10;index++){
  const candidate=discoverCandidate('manual_url',`https://independent.dev/history/${index}`,'Historical note',null,'2026-10-13T00:00:00Z');addCandidate(identity,candidate);
  const id='seed_'+index,base=newRuntimeProject(candidate,{project_id:id,execution_scope:'production',workspace_id:f.workspace,context:ctx,now:new Date('2026-10-13T00:00:00Z')});
  const project:HostProject={...base,generation_version:1,resume_stage:null,resume_policy:'automatic',reason:null,last_run_id:s.journal.run_id,batch_id:'historical-fixture',delivery_id:null,sources_verified_at:null};
  await s.journal.commitMany({['projects/'+id]:project},'project_created');
  const snapshot=extractWebSnapshot(candidate.url,f.article(candidate.url),'2026-10-13T00:00:00Z');project.snapshots=[{...snapshot,kind:'web'}];const sourceHash=snapshot.hash;project.classification={candidate_id:candidate.candidate_id,source_snapshot_hash:sourceHash,semantic_policy_hash:f.policy.semantic_policy_hash,attempts:1,format_repairs:0,pending:false,credential:{candidate_id:candidate.candidate_id,source_snapshot_hash:sourceHash,semantic_policy_hash:f.policy.semantic_policy_hash,content_eligibility:'allowed',evidence_hash:digest('historical evidence '+index)}};
  project.selection={decision:'research',reason_codes:['historical_fixture'],reason:'Historical fixture note.',dimension_ratings:{relevance:'strong',mechanism:'strong',evidence:'strong',transferability:'strong',increment:'strong'},questions:['Mechanism?','Boundary?','Limit?'],related_note_ids:[],evidence_ids:[]};project.state='selected';await s.journal.commitMany({['projects/'+id]:project},'stage_completed');
  project.research={project_id:id,questions:[{id:'q1',text:'Mechanism?',priority:'required'},{id:'q2',text:'Boundary?',priority:'required'},{id:'q3',text:'Limit?',priority:'required'}],answers:[{question_id:'q1',answer:null,evidence_ids:[],source_not_provided:true}],evidence:[],gaps:[],source_versions:[{url:candidate.url,hash:snapshot.hash,main:true,core:true,status:'read'}],mechanism_evidence_ids:[],boundary_evidence_ids:[],knowledge_increment:'Known seeded historical output'};project.state='researched';await s.journal.commitMany({['projects/'+id]:project},'research_complete');
  project.writing={note_path:`Organize Notes By AI/261013-history-${index}.md`,markdown:'# Historical output '+index,claims:[],figure_plan:[],resources:[],degradations:[]};project.state='drafted';await s.journal.commitMany({['projects/'+id]:project},'draft_complete');
  project.review={issues:[],file_hashes:{[project.writing.note_path]:digest(project.writing.markdown)},resource_manifest_hash:digest('[]')};project.state='validated';await s.journal.commitMany({['projects/'+id]:project},'review_result');
  project.delivery_id='history_delivery_'+index;project.sources_verified_at='2026-10-13T00:00:00Z';project.state='ready_for_delivery';await s.journal.commitMany({['projects/'+id]:project},'delivery_ready');project.state='publishing';await s.journal.commitMany({['projects/'+id]:project},'publishing_started');project.state='pr_open';project.candidate.pr_number=index+1;project.candidate.status='pr_open';project.candidate.project_id=id;await s.journal.commitMany({['projects/'+id]:project},'delivery_result');
  Object.assign(identity.candidates[candidate.candidate_id]!,project.candidate);const remote=new FakeGitHub();remote.pr={number:index+1,url:`https://github.com/test/repo/pull/${index+1}`,state:'open',branch:'fixture/history-'+index,head_sha:'e'.repeat(40),delivery_id:project.delivery_id};f.remotes.set(id,remote);
 }
 await s.journal.commitMany({identity},'fixture_pending_history_and_output_count',Array.from({length:3},(_,index)=>({path:`outputs/seed_${index}/Organize Notes By AI/261013-history-${index}.md`,bytes:Buffer.from('# Historical output '+index),role:'output' as const,project_id:'seed_'+index})));
 expect(s.journal.keys('projects/')).toHaveLength(10);expect([...f.remotes.values()].filter(remote=>remote.pr?.state==='open')).toHaveLength(10);expect(s.journal.handle.snapshot.manifest.files.filter(file=>file.role==='output')).toHaveLength(3);
}

it.each(['available','deadline','capacity'] as const)('three recorded outputs and ten pending FakePRs do not cap new work; only %s runtime admission governs it and cold continuation preserves the candidate',async mode=>{
 const f=await fixture();try{
  const first=await f.session(true);await seedPendingHistory(f,first);const url='https://independent.dev/new-after-counts';
  if(mode==='deadline')f.expire(true);if(mode==='capacity')f.stopCapacity(true);await first.run([url]);
  const identity=(await first.journal.load<IdentityState>('identity'))!,candidate=Object.values(identity.candidates).find(candidate=>candidate.url===url)!,project=(await first.journal.load<HostProject>('projects/'+candidate.project_id))!;
  expect(candidate).toBeDefined();expect(first.journal.keys('projects/')).toHaveLength(11);expect(first.journal.handle.snapshot.manifest.files.filter(file=>file.role==='output')).toHaveLength(3);
  if(mode==='available'){expect(project.state,f.modelErrors.join(',')).toBe('pr_open');expect(f.calls.map(call=>call.stage)).toEqual(['classify','selection','research','writing','review']);expect(f.remotes.get(project.project_id)!.calls.filter(call=>call==='pr')).toHaveLength(1);expect([...f.remotes.values()].filter(remote=>remote.pr?.state==='open')).toHaveLength(11);}
  else{expect(f.calls).toEqual([]);expect(first.journal.keys('invocations/')).toEqual([]);expect(project.state).toBe(mode==='deadline'?'discovered':'deferred');if(mode==='capacity')expect(project).toMatchObject({reason:'storage_capacity',resume_policy:'when_capacity_available'});expect([...f.remotes.values()].filter(remote=>remote.pr?.state==='open')).toHaveLength(10);}
  await first.closeLocal();f.expire(false);f.stopCapacity(false);const cold=await f.session();await cold.run();
  expect(cold.journal.keys('projects/')).toHaveLength(11);const resumed=(await cold.journal.load<HostProject>('projects/'+project.project_id))!;expect(resumed).toMatchObject({state:'pr_open',generation_version:1,candidate:{candidate_id:candidate.candidate_id}});expect(resumed.context.context_id).toBe(project.context.context_id);expect(f.calls.map(call=>call.stage),f.modelErrors.join(',')).toEqual(['classify','selection','research','writing','review']);expect(f.remotes.get(project.project_id)!.calls.filter(call=>call==='pr')).toHaveLength(1);expect([...f.remotes.values()].filter(remote=>remote.pr?.state==='open')).toHaveLength(11);expect(cold.journal.handle.snapshot.manifest.files.filter(file=>file.role==='output')).toHaveLength(3);
 }finally{await f.cleanup();}
},60_000);

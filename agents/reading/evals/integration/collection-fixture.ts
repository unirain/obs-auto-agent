import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal,ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController,type ControllerPorts} from '../../src/app/controller.js';
import {PolicyGate,type TrustedPolicy} from '../../src/policy/gate.js';
import {buildContext} from '../../src/context/index.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {UrlGateway} from '../../src/tools/fetch.js';
import {digest} from '../../src/stages/contracts.js';
import {parseDeployment} from '../../src/config/deployment.js';
import {readMonitorProjection,readonlyObjectStore} from '../../src/app/watchdog.js';
import {emptySourceProgress,type SourceProgress,type WebSourceAdapter} from '../../src/collect/sources.js';
import {parseDispatch} from '../../src/config/dispatch.js';
const policy:TrustedPolicy={commit:'a'.repeat(40),hash:digest('collection-policy'),semantic_policy_hash:digest('collection-semantics'),paused:false,paused_projects:[],sources:{langchain_blog:{enabled:true,domains:['www.langchain.com']},claude_resources:{enabled:true,domains:['claude.com']}},manual_url:{enabled:true},allowed_domains:['www.langchain.com','claude.com'],denied_domains:[],excluded_topics:[]};
/** Source adapters, host, records, restore and readonly monitor are real. Selection is
 * a local skip replay so these tests do not claim semantic quality or live delivery. */
export async function collectionFixture(){
 const root=await mkdtemp(join(tmpdir(),'reading-collection-flow-')),workspace='obs-notes-hub/reading-integration';
 const deployment=parseDeployment(JSON.parse(await readFile('agents/reading/deploy/examples/integration.json','utf8')));
 const store=new FileObjectStore(join(root,'objects'),100,{versioning:'never',acl:'private',anonymous_readable:false,lifecycle:[],endpoint:'https://oss-cn-beijing.aliyuncs.com'});
 let nextRun=0;const selected:string[]=[];let modelQueries=0;
 const session=async(sources:WebSourceAdapter[],initialize=false)=>{
  const number=++nextRun,local=join(root,'restore-'+number),manager=new ImmutableWorkspaceManager({store,scope:'production',prefix:deployment.workspace.prefix.replace(/\/$/,''),trusted_workspace_id:workspace,local_root:local,record_validator:validateHostRecords});
  const journal=new WorkspaceJournal(manager,await manager.restore(workspace,{allow_initialize:initialize}),'collection-'+number);
  const gate=new PolicyGate(async()=>policy,check=>journal.commit('policy-checks/'+check.check_id,check));
  const deadline=new RunDeadline(),executor=new StageExecutor({async *stream(){modelQueries++;throw new Error('unexpected_model_query');}},gate,new ApplicationInvocationJournal(journal));
  const ports:ControllerPorts={journal,gate,deadline,sources,context:async()=>{const context=buildContext({index:[],query:'source recovery fixture',heldout:{urls:new Set(),note_paths:new Set()},preferences_hash:digest('preferences'),skill_commit:'a'.repeat(40),skill_hash:digest('fixed skill'),prompt_hash:digest('fixed prompt'),model:'collection-replay',evidence_versions:[]});if(!await journal.load('contexts/'+context.context_id))await journal.commitMany({['contexts/'+context.context_id]:context},'generation_context_fixed');return context;},environment:async(_project,commit)=>({root:local,model:'collection-replay',executor,gate,gateway:new UrlGateway(async()=>{throw new Error('unexpected_source_download');}),deadline,skills:null,commit}),execute:async(project,stage)=>{if(stage!=='selection')throw new Error('unexpected_research');selected.push(project.candidate.url);return {project,decision:'skip',reason:'local_selection_replay',files:[],validated:false};},prepareResources:async()=>{throw new Error('unexpected_upload');},verifySources:async()=>{throw new Error('unexpected_verification');},seal:async()=>{throw new Error('unexpected_seal');},publish:async()=>{throw new Error('unexpected_publish');},reconcile:async project=>project};
  const controller=new ReadingController(ports);return {manager,journal,ports,local,controller,run:()=>controller.run(parseDispatch({mode:'scheduled'}),'fixture-owner')};
 };
 const progress=async(journal:WorkspaceJournal,source_id:string)=>await journal.load<SourceProgress>('sources/'+source_id+'/progress')??emptySourceProgress();
 return {root,store,deployment,session,progress,selected,queries:()=>modelQueries,monitor:()=>readMonitorProjection(readonlyObjectStore(store),deployment),cleanup:()=>rm(root,{recursive:true,force:true})};
}
export const langchainPage=(count:number,start=0,next=false)=>'<div class="blog-list is-normal">'+Array.from({length:count},(_,index)=>`<div class="blog-item"><h3>Mechanism ${start+index}</h3><a class="blog-link-absolute" href="/blog/mechanism-${start+index}"></a></div>`).join('')+'</div>'+(next?'<a class="w-pagination-next" href="?page=2">Next</a>':'');
export const claudeFeed=(count=1)=>'<rss version="2.0"><channel><title>Fixture public source</title>'+Array.from({length:count},(_,index)=>`<item><title>Engineering ${index}</title><link>https://claude.com/resources/articles/engineering-${index}</link><description>Mechanism fixture</description></item>`).join('')+'</channel></rss>';

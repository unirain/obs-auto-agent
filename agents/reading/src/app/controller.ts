import { canonicalJson } from '../contracts/index.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Usage } from '../contracts/index.js';
import type { Dispatch } from '../config/dispatch.js';
import { intakeManual } from '../collect/intake.js';
import { addCandidate,discoverCandidate,emptyIdentity,bindFetchedIdentity,type IdentityState } from '../collect/identity.js';
import { emptySourceProgress,type SourceProgress,type SourceResult,type WebSourceAdapter } from '../collect/sources.js';
import { applySourceResult,emptySourceHealth,type SourceHealth } from '../collect/incidents.js';
import { fairCandidates } from '../schedule.js';
import { digest,type Candidate,type StageTask } from '../stages/contracts.js';
import { executeProjectStage,newRuntimeProject,type RuntimeProject,type RuntimeEnvironment,type RuntimeFile,type RuntimeStep } from '../stages/driver.js';
import type { PolicyGate } from '../policy/gate.js';
import type { RunDeadline } from '../runtime/deadline.js';
import type { ContextBundle } from '../context/index.js';
import { previewReport } from '../preview/report.js';
import { WorkspaceJournal } from './journal.js';

export type HostProject=RuntimeProject & {generation_version:number;resume_stage:StageTask['stage']|null;
  resume_policy:'automatic'|'manual'|'when_policy_allows'|'when_capacity_available';reason:string|null;
  last_run_id:string|null;batch_id:string;delivery_id:string|null;sources_verified_at:string|null};
export interface ControllerPorts {
  journal:WorkspaceJournal;
  gate:PolicyGate;
  readArtifact?(path:string):Promise<Uint8Array>;
  deadline:RunDeadline;
  environment(project:HostProject,commit:(project:RuntimeProject,files:RuntimeFile[],reason:string)=>Promise<void>):Promise<RuntimeEnvironment>;
  context(candidate:Candidate):Promise<ContextBundle>;
  sources:WebSourceAdapter[];
  prepareResources(project:HostProject,files:Record<string,Uint8Array>):Promise<HostProject>;
  verifySources(project:HostProject):Promise<string>;
  seal(project:HostProject,files:Record<string,Uint8Array>):Promise<void>;
  reconcile(project:HostProject):Promise<HostProject>;
  publish(project:HostProject):Promise<HostProject>;
  refreshDelivery?(project:HostProject,verified_at:string):Promise<HostProject>;
  now?:()=>Date;
  execute?:typeof executeProjectStage;
}
export type RunReport={schema_version:1;run_id:string;workspace_id:string;execution_scope:'preview'|'production';mode:Dispatch['mode'];started_at:string;finished_at:string;
  outcome:'success_preview'|'success'|'success_no_selection'|'partial'|'failed_collection'|'deferred_work';source_results:SourceResult[];
  project_ids:string[];usage:Usage;failures:{subject:string;reason:string}[];delivery_results:{project_id:string;state:string}[]};
export class SourceRevisionChanged extends Error {
  constructor(readonly source_url:string,readonly snapshot_hash:string){super('source_changed_requires_new_generation');}
}
const stageFor=(p:HostProject):StageTask['stage']|null=>p.resume_stage??({discovered:'selection',selected:'research',researching:'research',researched:'writing',drafted:'review'} as Record<string,StageTask['stage']>)[p.state]??null;
const terminal=new Set(['skipped','merged','closed_unmerged','preview_ready','pr_open']);

/** Host lifecycle controller. Every transition and discovered page crosses the same durable journal. */
export class ReadingController {
  private readonly now:()=>Date;
  constructor(private readonly ports:ControllerPorts){this.now=ports.now??(()=>new Date());}
  private async identities():Promise<IdentityState>{return await this.ports.journal.load<IdentityState>('identity')??emptyIdentity();}
  private async projects():Promise<HostProject[]>{const result:HostProject[]=[];for(const key of this.ports.journal.keys('projects/')){const p=await this.ports.journal.load<HostProject>(key);if(p)result.push(p);}return result;}
  private async save(project:HostProject,files:RuntimeFile[]=[],reason='project_transition',capabilityOverride?:string):Promise<void>{
    const identity=await this.identities();let candidate=identity.candidates[project.candidate.candidate_id];
    let duplicateId:string|null=null;
    if(reason==='source_snapshot'&&candidate){
      const snapshot=project.snapshots.find(s=>s.requested_url===project.candidate.url||s.url===project.candidate.url);
      if(snapshot){
        const other=identity.aliases[snapshot.url]??identity.content[snapshot.hash];
        if(other&&other!==candidate.candidate_id){
          const survivor=identity.candidates[other];if(!survivor)throw new Error('identity_index_corrupt');
          // The first project retains ownership; duplicate discovery only contributes source provenance.
          candidate.project_id=null;
          bindFetchedIdentity(identity,candidate.candidate_id,{final_url:snapshot.url,body_hash:snapshot.hash,origins:candidate.origin_source_ids});
          duplicateId=other;project.state='skipped';project.reason='duplicate_identity:'+other;project.resume_stage=null;
        }else bindFetchedIdentity(identity,candidate.candidate_id,{final_url:snapshot.url,body_hash:snapshot.hash,origins:candidate.origin_source_ids});
      }
    }
    if(candidate&&!duplicateId){candidate.title=project.candidate.title??candidate.title;candidate.content_hash=project.candidate.content_hash??candidate.content_hash;candidate.aliases=[...new Set([...candidate.aliases,...project.candidate.aliases])];candidate.origin_source_ids=[...new Set([...candidate.origin_source_ids,...project.candidate.origin_source_ids])];candidate.status=project.state;candidate.project_id=project.project_id;project.candidate=structuredClone(candidate);}
    const records:Record<string,unknown>={['projects/'+project.project_id]:project,identity};
    const capability=capabilityOverride??({classification_result:'classify_only',classification_format_invalid:'classify_only',selection_result:'select',research_complete:'research',research_incomplete:'research',research_batch_yield:'research',research_deferred:'research',research_skipped:'research',draft_complete:'write',review_result:'review'} as Record<string,string>)[reason];
    if(capability){
      const order=await this.ports.journal.load<string[]>('invocation_order')??[];
      for(const id of [...order].reverse()){
        const invocation=await this.ports.journal.load<{subject_id:string;capability:string;status:string}>('invocations/'+id);
        if(invocation?.subject_id==='project:'+project.project_id&&invocation.capability===capability&&invocation.status==='succeeded'&&!await this.ports.journal.load('consumed/'+id)){
          records['consumed/'+id]={project_id:project.project_id,reason};break;
        }
      }
    }
    await this.ports.journal.commitMany(records,reason,files);
    if(duplicateId)throw new Error('duplicate_identity:'+duplicateId);
  }
  private async artifactFiles(project:HostProject):Promise<Record<string,Uint8Array>>{
    const result:Record<string,Uint8Array>={};const prefix=`projects/${project.project_id}/draft/`;
    for(const file of this.ports.journal.handle.snapshot.manifest.files)if(file.path.startsWith(prefix))result[file.path.slice(prefix.length)]=this.ports.readArtifact?await this.ports.readArtifact(file.path):await readFile(join(this.ports.journal.handle.root_dir,file.path));
    return result;
  }
  private usage():Usage{
    const records=Object.entries(this.ports.journal.handle.records).filter(([key])=>{
      if(!key.startsWith('invocations/'))return false;
      const id=key.slice('invocations/'.length);
      const meta=this.ports.journal.handle.records['invocation_meta/'+id] as {run_id?:string}|undefined;
      return meta?.run_id===this.ports.journal.run_id;
    }).map(([,v])=>v as unknown as {usage:Usage});
    const known=records.every(r=>r.usage.cost_status==='known'&&r.usage.cost_usd!==null);
    return {input_tokens:records.reduce((n,r)=>n+r.usage.input_tokens,0),output_tokens:records.reduce((n,r)=>n+r.usage.output_tokens,0),cost_status:known?'known':'unknown',cost_usd:known?records.reduce((n,r)=>n+(r.usage.cost_usd??0),0):null};
  }
  async run(dispatch:Dispatch,submittedBy:string):Promise<RunReport>{
    const scope=this.ports.journal.handle.execution_scope;
    if((dispatch.mode==='preview')!==(scope==='preview'))throw new Error('controller_scope_mismatch');
    const report:RunReport={schema_version:1,run_id:this.ports.journal.run_id,workspace_id:this.ports.journal.handle.workspace_id,execution_scope:scope,mode:dispatch.mode,started_at:this.now().toISOString(),finished_at:'',outcome:'deferred_work',source_results:[],project_ids:[],usage:this.usage(),failures:[],delivery_results:[]};
    // Reconcile before any new generation, freshness assessment or policy-dependent remote writing.
    if(scope==='production')for(const project of await this.projects())if(['publishing','pr_open'].includes(project.state)){
      try{await this.save(await this.ports.reconcile(project),[],'github_reconciled');}catch(error){report.failures.push({subject:project.project_id,reason:reasonOf(error)});}
    }
    if(dispatch.mode==='scheduled'&&dispatch.input_urls.length){
      await intakeManual({read:()=>this.identities(),commit:(state,reason)=>this.ports.journal.commitMany({identity:state},reason)},this.ports.gate,
        {submission_id:dispatch.submission_id??`sub_${digest(JSON.stringify({run_id:report.run_id,urls:dispatch.input_urls}))}`,urls:dispatch.input_urls,submitted_by:submittedBy,submitted_at:this.now().toISOString(),execution_scope:'production'});
    }
    if(dispatch.mode==='preview'&&dispatch.input_urls.length){
      const identity=await this.identities();
      for(const url of dispatch.input_urls)addCandidate(identity,discoverCandidate('manual_url',url,null,null,this.now().toISOString()));
      await this.ports.journal.commit('identity',identity);
    }
    if(dispatch.mode==='scheduled')for(const source of this.ports.sources){
      let progress=await this.ports.journal.load<SourceProgress>(`sources/${source.config.source_id}/progress`)??emptySourceProgress();
      let continuePages=true;
      while(continuePages){
        const page=await source.collect(progress,this.now());const identity=await this.identities();
        for(const candidate of page.candidates)addCandidate(identity,candidate);
        const previousHealth=await this.ports.journal.load<SourceHealth>('sources/health')??emptySourceHealth();
        const health=applySourceResult(previousHealth,page.result,report.workspace_id,scope,this.now().toISOString());
        await this.ports.journal.commitMany({identity,[`sources/${source.config.source_id}/progress`]:page.progress,[`sources/${source.config.source_id}/result`]:page.result,'sources/health':health},'source_page_and_candidates');
        report.source_results=report.source_results.filter(r=>r.source_id!==page.result.source_id);report.source_results.push(page.result);progress=page.progress;
        continuePages=page.next!==null&&page.result.status!=='failed';
        if(continuePages&&!this.ports.deadline.mayStart())break;
      }
    }
    if(['scheduled','preview'].includes(dispatch.mode)){
      const identity=await this.identities();const existing=await this.projects();
      for(const candidate of Object.values(identity.candidates))if(!candidate.project_id&&!['skipped','merged','closed_unmerged'].includes(candidate.status)&&!existing.some(p=>p.candidate.candidate_id===candidate.candidate_id))await this.save(await this.makeProject(candidate),[],'project_created');
    }
    const candidates=await this.projects();
    if((dispatch.mode==='resume'||dispatch.mode==='publish-only')&&!candidates.some(p=>p.project_id===dispatch.project_id))throw new Error('existing_project_required');
    const order=fairCandidates(candidates.map(p=>({id:p.project_id,source_id:p.candidate.source_id,discovered_at:p.candidate.discovered_at,resuming:p.state!=='discovered',executable:!terminal.has(p.state)&&(p.resume_policy!=='manual'),priority:0,last_run_id:p.last_run_id})),this.now(),report.run_id);
    const ids=dispatch.project_id?[dispatch.project_id]:order.map(item=>item.id);
    for(const id of ids){
      let project=(await this.ports.journal.load<HostProject>(`projects/${id}`))!;
      if(terminal.has(project.state)||project.resume_policy==='manual')continue;
      if(project.state==='publishing'){report.failures.push({subject:id,reason:'delivery_reconciliation_required'});continue;}
      report.project_ids.push(id);
      const commit=async(updated:RuntimeProject,files:RuntimeFile[],reason:string)=>{
        const priorCapability=project.pending_query?.capability;
        project={...project,...updated};
        if(reason==='selection_result'&&project.selection){project.state=project.selection.decision==='research'?'selected':project.selection.decision==='skip'?'skipped':'deferred';project.resume_stage=null;}
        if(reason==='research_complete'){project.state='researched';project.resume_stage=null;}
        if(reason==='draft_complete'){project.state='drafted';project.resume_stage=null;}
        if(reason==='review_result'&&project.review){
          const blocked=project.review.issues.some(i=>i.severity==='blocking');
          project.state=blocked?'drafted':scope==='preview'?'preview_ready':'validated';
          project.resume_stage=blocked?'writing':null;
        }
        const formatCapability=/^(classify_only|select|research|write|review)_format_(invalid|exhausted)$/.exec(reason)?.[1]??(/stage_format_(invalid|exhausted)/.test(reason)?priorCapability:undefined);
        await this.save(project,files,reason,formatCapability);
      };
      const environment=await this.ports.environment(project,commit);
      if(dispatch.mode!=='publish-only'&&!environment.deadline.mayStart())break;
      if(project.last_run_id!==report.run_id&&project.reason==='batch_yield'){
        project.counters.tool_calls=0;project.counters.supplementary_materials=0;project.counters.download_bytes=0;project.counters.download_resources=0;project.batch_id=`batch_${randomUUID()}`;
      }
      project.last_run_id=report.run_id;await this.save(project,[],'batch_claimed');
      if(dispatch.mode==='publish-only'&&project.state!=='ready_for_delivery'){
        report.failures.push({subject:id,reason:'publish_only_requires_ready_delivery'});continue;
      }
      if(dispatch.mode==='resume'&&project.delivery_id&&project.state==='deferred'&&/expired|classification|freshness|verification/.test(project.reason??'')){
        try{
          const reconciled=await this.ports.reconcile(project);
          if(['publishing','pr_open','merged','closed_unmerged'].includes(reconciled.state)){project=reconciled;await this.save(project);continue;}
          const verified=await this.ports.verifySources(project);
          if(this.ports.refreshDelivery){project=await this.ports.refreshDelivery(project,verified);await this.save(project,[],'delivery_verification_refreshed');}
        }catch(error){
          if(error instanceof SourceRevisionChanged){project=await this.restartGeneration(project,error);}
          else{project=this.hold(project,'review',reasonOf(error));await this.save(project);continue;}
        }
      }
      while(dispatch.mode!=='publish-only'){
        const stage=stageFor(project);if(!stage)break;
        let files=await this.artifactFiles(project);
        if(stage==='review'&&scope==='production'){
          try{project=await this.ports.prepareResources(project,files);await this.save(project,[],'resource_urls_applied');files=await this.artifactFiles(project);}
          catch(error){project=this.hold(project,stage,reasonOf(error));await this.save(project);break;}
        }
        const step=await (this.ports.execute??executeProjectStage)(project,stage,{...environment,files,final_resources:scope==='production'&&stage==='review'});
        project={...project,...step.project};
        if(step.decision!=='complete'){
          if(step.reason==='revision_required'){
            project.resume_stage='writing';project.state='drafted';project.reason=step.reason;await this.save(project,step.files,'review_requires_revision');continue;
          }
          project=step.decision==='skip'||step.reason?.startsWith('duplicate_identity:')?{...project,state:'skipped',reason:step.reason,resume_stage:null}:this.hold(project,stage,step.reason??step.decision,step.decision==='manual');
          await this.save(project,step.files,'stage_yielded');break;
        }
        project.resume_stage=null;project.reason=null;
        project.state=({selection:'selected',research:'researched',writing:'drafted',review:step.validated?(scope==='preview'?'preview_ready':'validated'):'drafted'} as Record<StageTask['stage'],string>)[stage];
        await this.save(project,step.files,'stage_completed');
        if(stage==='review')break;
      }
      if(project.state==='preview_ready'){
        const files=await this.artifactFiles(project);
        const preview=previewReport('preview',report.workspace_id,id,'preview_ready',project.writing,files,this.usage(),this.now());
        await this.ports.journal.commitMany({[`previews/${id}`]:preview},'preview_output_sealed',Object.entries(files).map(([path,bytes])=>({path:`outputs/${id}/${path}`,bytes,role:'output',project_id:id})));
      }
      if(scope==='production'&&['validated','ready_for_delivery'].includes(project.state)){
        try {
          if(project.state==='validated'){
            project.sources_verified_at=await this.ports.verifySources(project);
            project.delivery_id??=`delivery_${id}_g${project.generation_version}`;
            await this.save(project,[],'sources_verified');await this.ports.seal(project,await this.artifactFiles(project));
            project.state='ready_for_delivery';await this.save(project,[],'delivery_ready');
          }
          project.state='publishing';await this.save(project,[],'publishing_started');
          project=await this.ports.publish(project);await this.save(project,[],'delivery_result');
        }catch(error){
          if(project.state==='publishing'){project.reason=reasonOf(error);await this.save(project,[],'publishing_requires_reconciliation');}
          else if(error instanceof SourceRevisionChanged){project=await this.restartGeneration(project,error);}
          else{project=this.hold(project,'review',reasonOf(error));await this.save(project);}
          report.failures.push({subject:id,reason:reasonOf(error)});
        }
      }
      report.delivery_results.push({project_id:id,state:project.state});
      if(project.state==='deferred')report.failures.push({subject:id,reason:project.reason??'deferred'});
    }
    const all=await this.projects();
    const sourceFailure=report.source_results.some(r=>r.status==='failed'||r.status==='partial'&&r.reason_code!=='pagination_pending');
    const sourceSuccess=report.source_results.some(r=>r.status==='success'||r.last_success_at!==null);
    const collectionPending=report.source_results.some(r=>r.reason_code==='pagination_pending');
    const produced=all.some(p=>p.last_run_id===report.run_id&&['preview_ready','pr_open'].includes(p.state));
    const unfinished=all.some(p=>!terminal.has(p.state));
    report.outcome=sourceFailure&&sourceSuccess||report.failures.length>0&&produced?'partial':report.source_results.some(r=>!['disabled','not_attempted'].includes(r.status))&&report.source_results.filter(r=>!['disabled','not_attempted'].includes(r.status)).every(r=>r.status==='failed')?'failed_collection':report.failures.length||collectionPending||unfinished?'deferred_work':produced?(scope==='preview'?'success_preview':'success'):'success_no_selection';
    report.finished_at=this.now().toISOString();report.usage=this.usage();
    await this.ports.journal.commit(`runs/${report.run_id}`,report);
    return report;
  }
  private async makeProject(candidate:Candidate):Promise<HostProject>{
    const base=newRuntimeProject(candidate,{project_id:`project_${candidate.candidate_id.slice(0,32)}`,execution_scope:this.ports.journal.handle.execution_scope,workspace_id:this.ports.journal.handle.workspace_id,context:await this.ports.context(candidate),now:this.now()});
    return {...base,generation_version:1,resume_stage:null,resume_policy:'automatic',reason:null,last_run_id:null,batch_id:`batch_${randomUUID()}`,delivery_id:null,sources_verified_at:null};
  }
  private async restartGeneration(previous:HostProject,error:SourceRevisionChanged):Promise<HostProject>{
    const evidence_versions=[...previous.context.evidence_versions,canonicalJson({url:error.source_url,hash:error.snapshot_hash})];
    const {context_id:_old,...settings}=previous.context;
    const content={...settings,evidence_versions};const context={context_id:digest(canonicalJson(content)),...content};
    const fresh=newRuntimeProject(previous.candidate,{project_id:previous.project_id,execution_scope:previous.execution_scope,workspace_id:previous.workspace_id,context,now:new Date(previous.created_at)});
    const project:HostProject={...fresh,generation_version:previous.generation_version+1,resume_stage:'selection',resume_policy:'automatic',reason:'source_changed_new_generation',last_run_id:this.ports.journal.run_id,batch_id:'batch_'+randomUUID(),delivery_id:null,sources_verified_at:null};
    project.filename=previous.filename;project.note_date=previous.note_date;
    const removals=this.ports.journal.handle.snapshot.manifest.files.filter(f=>f.path.startsWith('projects/'+previous.project_id+'/')).map(f=>f.path);
    await this.ports.journal.commitMany({['generation-archives/'+previous.project_id+'/g'+previous.generation_version]:{context_id:previous.context.context_id,generation_version:previous.generation_version,delivery_id:previous.delivery_id,source_versions:previous.research?.source_versions??[],reason:error.message},['contexts/'+context.context_id]:context,['projects/'+project.project_id]:project},'source_changed_new_generation',[{path:'inputs/'+context.context_id+'/context.json',bytes:Buffer.from(canonicalJson(context)),role:'input'}],removals);
    await this.save(project);return project;
  }
  private hold(project:HostProject,stage:StageTask['stage'],reason:string,manual=false):HostProject{
    return {...project,state:'deferred',reason,resume_stage:stage,resume_policy:manual?'manual':/policy|paused|source_disabled|domain_denied/.test(reason)?'when_policy_allows':/capacity/.test(reason)?'when_capacity_available':'automatic'};
  }
}
function reasonOf(error:unknown):string{return error instanceof Error?error.message:'operation_failed';}

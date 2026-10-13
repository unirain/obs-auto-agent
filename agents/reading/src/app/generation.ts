import {canonicalJson,sha256,type InvocationRecord} from '../contracts/index.js';
import {verifyContext,type ContextBundle} from '../context/index.js';
import {newRuntimeProject} from '../stages/driver.js';
import type {HostProject} from './controller.js';
import type {WorkspaceJournal} from './journal.js';
import {retryAuthorized} from './recovery.js';

export interface NewGenerationInput {guidance:string;approved_skill_commit?:string;refresh_runtime?:boolean}
export interface NewGenerationPorts {
  readiness?(project:HostProject):Promise<{complete:boolean;allowed:boolean;evidence:unknown}>;
  prepare_context?(project:HostProject,input:NewGenerationInput):Promise<ContextBundle>;
}
/** A new version is an explicit operator input change, never an automatic reset of an exhausted budget. */
export async function prepareNewGeneration(journal:WorkspaceJournal,project:HostProject,input:NewGenerationInput,actor:string,recovery_id:string,evidence_reference:string,ports:NewGenerationPorts){
 if(!input.guidance.trim())throw new Error('generation_changed_input_required');
 const updates:Record<string,unknown>={};
 for(const key of journal.keys('invocations/')){
  const call=await journal.load<InvocationRecord>(key);if(!call||call.subject_id!=='project:'+project.project_id)continue;
  if(['prepared','running','unknown'].includes(call.status)&&!await retryAuthorized(journal,call,'',''))throw new Error('generation_invocation_unresolved');
  if(['succeeded','failed'].includes(call.status))updates['binding-superseded/'+call.invocation_id]={subject_id:call.subject_id,input_hash:call.input_hash,from_generation:project.generation_version,to_generation:project.generation_version+1,reason:'operator_changed_input'};
 }
 let readiness:unknown={kind:'preview_no_remote_capabilities'};
 if(project.execution_scope==='production'){
  if(!ports.readiness)throw new Error('generation_remote_readiness_unavailable');
  const result=await ports.readiness(project);if(!result.complete||!result.allowed)throw new Error('generation_remote_readiness_denied');readiness=result.evidence;
 }
 const nextBase=(input.approved_skill_commit||input.refresh_runtime)?await ports.prepare_context?.(project,input):project.context;
 if(!nextBase)throw new Error('generation_context_preparation_unavailable');verifyContext(nextBase);
 if(nextBase.preferences_hash!==project.context.preferences_hash||canonicalJson(nextBase.examples)!==canonicalJson(project.context.examples)||canonicalJson(nextBase.example_texts)!==canonicalJson(project.context.example_texts)||canonicalJson(nextBase.tool_domains??null)!==canonicalJson(project.context.tool_domains??null)||nextBase.model!==project.context.model||nextBase.model_provider!==project.context.model_provider||nextBase.model_base_url!==project.context.model_base_url)throw new Error('generation_context_scope_changed');
 const fingerprint=sha256(canonicalJson({guidance:input.guidance,skill_commit:nextBase.skill_commit,skill_hash:nextBase.skill_hash,runtime_versions:nextBase.runtime_versions??null,runtime_limits:nextBase.runtime_limits??null}));
 for(const entry of project.context.evidence_versions){let prior;try{prior=JSON.parse(entry) as {kind?:string;fingerprint?:string};}catch{continue;}if(prior.kind==='operator_input'&&prior.fingerprint===fingerprint)throw new Error('generation_input_unchanged');}
 const {context_id:_old,...settings}=nextBase;const content={...settings,evidence_versions:[...nextBase.evidence_versions,canonicalJson({kind:'operator_input',fingerprint,guidance:input.guidance,actor,recovery_id,evidence_reference})]};
 const context:ContextBundle={context_id:sha256(canonicalJson(content)),...content};verifyContext(context);
 const fresh=newRuntimeProject(project.candidate,{project_id:project.project_id,execution_scope:project.execution_scope,workspace_id:project.workspace_id,context,now:new Date(project.created_at)});
 const next:HostProject={...fresh,generation_version:project.generation_version+1,resume_stage:'selection',resume_policy:'automatic',reason:'operator_changed_input',last_run_id:null,batch_id:'generation_'+recovery_id,delivery_id:null,sources_verified_at:null};
 next.filename=project.filename;next.note_date=project.note_date;
 // Source facts and classification allowance belong to candidate/content/policy binding, not the generation budget.
 next.snapshots=project.snapshots;next.read_ranges=project.read_ranges;next.classification=project.classification;
 updates['generation-archives/'+project.project_id+'/g'+project.generation_version]={schema_version:1,project,workspace_revision:journal.handle.revision,actor,recovery_id,evidence_reference,readiness,archived_at:new Date().toISOString()};
 updates['contexts/'+context.context_id]=context;updates['projects/'+project.project_id]=next;
 const remove_paths=journal.handle.snapshot.manifest.files.filter(file=>(file.path.startsWith('projects/'+project.project_id+'/')&&!file.path.startsWith('projects/'+project.project_id+'/snapshots/'))||file.path.startsWith('outputs/'+project.project_id+'/')).map(file=>file.path);
 return {updates,next,context,remove_paths,context_file:{path:'inputs/'+context.context_id+'/context.json',role:'input' as const,bytes:Buffer.from(canonicalJson(context))}};
}

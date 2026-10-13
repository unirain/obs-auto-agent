import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Octokit} from '@octokit/rest';
import {parse as parseYaml} from 'yaml';
import {buildMaintenanceApplication,decodeDelivery,type BuildMaintenanceOptions} from './bootstrap.js';
import type {HostProject} from './controller.js';
import type {NewGenerationInput} from './generation.js';
import type {RecoveryRequest} from './recovery.js';
import {createGitHubAppClient,parseAppCredentials} from '../publish/auth.js';
import {OctokitGitHub} from '../publish/github.js';
import {checkGenerationReadiness} from '../publish/regeneration.js';
import {prepareHumanReviewFeedback} from '../publish/feedback.js';
import type {DeliveryRecord} from '../publish/types.js';
import {verifyContext,type ContextBundle} from '../context/index.js';
import {canonicalJson,sha256} from '../contracts/index.js';
import {materializeSkills} from '../tools/skills.js';
import {inspectToolsRuntime} from '../tools/sandbox.js';
import {readInstalledSdkVersion,type RuntimeVersions} from '../runtime/versions.js';
import {effectiveRuntimeLimits,parseRuntimeLimits} from '../runtime/limits.js';
import {GitHubPolicySource} from '../config/trusted-policy.js';
export interface RecoveryBootstrapOptions extends BuildMaintenanceOptions {notes_repository?:string;runtime_versions_provider?:()=>Promise<Omit<RuntimeVersions,'model_version_status'>>}
/** Management composition does not construct an SDK, uploader or model credential reader. */
export async function buildRecoveryApplication(options:RecoveryBootstrapOptions){
 const app=await buildMaintenanceApplication(options);const journal=app.journal;const deployment=options.deployment,env=options.env??process.env;
 let github:Promise<OctokitGitHub>|undefined;
 const remote=()=>github??=(async()=>{if(deployment.execution_scope!=='production'||!deployment.target_repository||!deployment.github_app_credential_ref)throw new Error('management_remote_scope_unavailable');const client=createGitHubAppClient(parseAppCredentials(env[deployment.github_app_credential_ref]));const [owner,repo]=deployment.target_repository.split('/');const info=(await client.repos.get({owner:owner!,repo:repo!})).data;return new OctokitGitHub(client,deployment.target_repository,info.default_branch);})();
 const loadSeal=async(id:string)=>{const value=await journal.load<Parameters<typeof decodeDelivery>[0]>('sealed-'+id);if(!value||value.schema_version!==1)throw new Error('management_seal_unavailable');return decodeDelivery(value);};
 const readiness=async(project:HostProject)=>{
  const indexed=await journal.load<string[]>('delivery-project-'+project.project_id)??[];const ids=new Set(indexed);
  for(const key of journal.keys('delivery-')){const value=await journal.load<DeliveryRecord>(key);if(value?.project_id===project.project_id&&typeof value.delivery_id==='string')ids.add(value.delivery_id);}
  for(const key of journal.keys('sealed-')){const value=await journal.load<{project_id?:string;delivery_id?:string}>(key);if(value?.project_id===project.project_id&&typeof value.delivery_id==='string')ids.add(value.delivery_id);}
  if(project.delivery_id)ids.add(project.delivery_id);
  const history=[];for(const id of ids)history.push({seal:await loadSeal(id),record:await journal.load<DeliveryRecord>('delivery-'+id)??null});
  const result=await checkGenerationReadiness({github:await remote(),repository:deployment.target_repository!,workspace_id:project.workspace_id,project_id:project.project_id,expected_delivery_ids:[...ids],history});
  return {complete:result.complete,allowed:result.status==='allowed',evidence:result};
 };
 const prepare_context=async(project:HostProject,input:NewGenerationInput):Promise<ContextBundle>=>{
  verifyContext(project.context);const {context_id:_old,...content}=structuredClone(project.context);
  if(input.approved_skill_commit){if(!options.notes_repository)throw new Error('approved_skill_repository_required');const bundle=await materializeSkills(options.notes_repository,input.approved_skill_commit,join(options.local_root??'.reading-local','management-skills',randomUUID()));if(!bundle.adapted)throw new Error('approved_cloud_skill_not_adapted');content.skill_commit=bundle.commit;content.skill_hash=bundle.hash;}
  if(input.refresh_runtime){const actual=options.runtime_versions_provider?await options.runtime_versions_provider():await(async()=>{const sdk=await readInstalledSdkVersion(),tools=await inspectToolsRuntime(env.READING_TOOLS_IMAGE);return {...sdk,tools_image_id:tools.image_id,tools_manifest_hash:tools.manifest_hash};})();content.runtime_versions={...actual,model_version_status:'requested_alias'};
   const token=env.GITHUB_TOKEN??env.READING_REPOSITORY_READ_TOKEN;const [owner,repo]=deployment.implementation_repository.split('/');const source=options.policy_source??(token?new GitHubPolicySource(new Octokit({auth:token}),owner!,repo!):undefined);if(!source)throw new Error('management_policy_source_unavailable');const snapshot=await source.readSnapshot();const current=parseRuntimeLimits(parseYaml(snapshot.files['runtime.yaml']) as Record<string,unknown>);content.runtime_limits=effectiveRuntimeLimits(content.runtime_limits,current);
  }
  const context={context_id:sha256(canonicalJson(content)),...content};verifyContext(context);return context;
 };
 const prepare_feedback=async(request:Extract<RecoveryRequest,{action:'record_feedback'}>,actor:string,project:HostProject)=>{
  const seal=await loadSeal(request.delivery_id),record=await journal.load<DeliveryRecord>('delivery-'+request.delivery_id);if(!record||record.project_id!==project.project_id||seal.project_id!==project.project_id)throw new Error('feedback_project_binding_mismatch');
  const result=await prepareHumanReviewFeedback({feedback:{schema_version:1,delivery_id:request.delivery_id,actor,recorded_at:new Date().toISOString(),reason:request.feedback_reason??null,review_minutes:request.review_minutes??null,origin:'trusted_management'},trusted_actor:actor,repository:deployment.target_repository!,workspace_id:project.workspace_id,request_id:request.recovery_id,seal,record,github:await remote()});return result.records;
 };
 return {...app,ports:{readiness,prepare_context,prepare_feedback}};
}

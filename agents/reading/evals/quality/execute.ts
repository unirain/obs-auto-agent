import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildApplication,type BuildApplicationOptions} from '../../src/app/bootstrap.js';
import type {HostProject} from '../../src/app/controller.js';
import {parseRunReport,type RunReport} from '../../src/app/run-records.js';
import {parseDeployment,type Deployment} from '../../src/config/deployment.js';
import {parseDispatch} from '../../src/config/dispatch.js';
import {canonicalJson,sha256,type InvocationRecord} from '../../src/contracts/index.js';
import {assertUtcInstant} from '../../src/contracts/utc.js';
import type {ContextBundle} from '../../src/context/index.js';
import {addCandidate,discoverCandidate,emptyIdentity,type IdentityState,normalizeUrl} from '../../src/collect/identity.js';
import {EvidenceRegistry,type MaterialSnapshot} from '../../src/tools/evidence.js';
import {parseMaterialSnapshot} from '../../src/stages/records.js';
import {assertG1Evidence} from '../../src/storage/gates.js';
import {buildUsageLedger} from '../../src/workspace/usage.js';
import {heldoutExclusion,verifyFrozenDataset,type freezeDataset,type LabeledSample,type QualityLabel} from './evaluation.js';

const exec=promisify(execFile);
type Frozen=ReturnType<typeof freezeDataset>;
export type SnapshotDocument={schema_version:1;snapshots:{sample_id:string;snapshot:MaterialSnapshot}[]};
export type EvaluationExecution={
  schema_version:1;frozen_hash:string;session:string;layer:'live'|'local_replay';split:'development'|'holdout';
  samples:LabeledSample[];cases:EvaluationCase[];quality_gate:'awaiting_user_confirmation';
  model_version_status:'identifier_only_unverified';
};
export type EvaluationCase={
  schema_version:1;sample_id:string;workspace_id:string;revision:string;project_id:string|null;
  state:string;reason:string|null;predicted:QualityLabel|null;source_snapshot_hash:string;
  context_id:string|null;versions:RunReport['versions']['projects'];run_ids:string[];
  run_records:{run_id:string;input_commit:string|null;implementation_commit:string|null;policy_check_refs:string[]}[];
  invocation_facts:{invocation_id:string;input_hash:string;context_hash:string;messages:{message_id:string;sha256:string}[]}[];
  usage:RunReport['usage'];known_duration_ms:number;duration_ms:number|null;
  failures:RunReport['failures'];artifact_hashes:Record<string,string>;
  checks:{formal_upload:'not_exercised';formal_url:'not_exercised';github_pr:'not_exercised'};
};
export interface ExecuteEvaluationOptions {
  frozen:Frozen;snapshots:SnapshotDocument;deployment:Deployment;session:string;
  split:'development'|'holdout';sample_ids?:string[];notes_repository:string;
  implementation_repository?:string;local_root?:string;env?:NodeJS.ProcessEnv;abort_signal?:AbortSignal;
  /** Only tests can provide replay composition; the CLI always uses the real host. */
  replay?:{build:(options:BuildApplicationOptions)=>ReturnType<typeof buildApplication>};
}

/** Validate every bound body before initialization; titles, URLs and arbitrary hashes are insufficient. */
export function validatedSnapshots(frozen:Frozen,document:SnapshotDocument):Map<string,MaterialSnapshot>{
  verifyFrozenDataset(frozen);
  if(!document||document.schema_version!==1||Object.keys(document).some(k=>!['schema_version','snapshots'].includes(k))||!Array.isArray(document.snapshots)||document.snapshots.length!==frozen.samples.length)throw new Error('evaluation_snapshot_document_invalid');
  const result=new Map<string,MaterialSnapshot>();
  const fields=new Set(['url','text','hash','retrieved_at','links','link_locators','kind','capture_method','pages','commit','file','requested_url','figures','canonical_url','title']);
  for(const row of document.snapshots){
    if(!row||Object.keys(row).some(k=>!['sample_id','snapshot'].includes(k))||result.has(row.sample_id))throw new Error('evaluation_snapshot_identity_invalid');
    const sample=frozen.samples.find(sample=>sample.id===row.sample_id),snapshot=row.snapshot;
    if(!sample||!snapshot||Object.keys(snapshot).some(k=>!fields.has(k))||typeof snapshot.text!=='string'||Buffer.byteLength(snapshot.text)>20_000_000||snapshot.hash!==sample.source_snapshot_hash||sha256(snapshot.text)!==snapshot.hash||!['web','pdf','code'].includes(snapshot.kind))throw new Error('evaluation_snapshot_binding_mismatch');
    parseMaterialSnapshot(snapshot);
    if(normalizeUrl(snapshot.requested_url??snapshot.url)!==normalizeUrl(sample.url))throw new Error('evaluation_snapshot_url_mismatch');
    for(const url of [snapshot.url,snapshot.requested_url??snapshot.url,...snapshot.links??[]])normalizeUrl(url);
    if(!Array.isArray(snapshot.links)||snapshot.links.some(url=>typeof url!=='string')||snapshot.pages!==undefined&&(!Array.isArray(snapshot.pages)||snapshot.pages.some(page=>typeof page!=='string'))||snapshot.kind==='pdf'&&(!snapshot.pages?.length||snapshot.pages.join('\n\f\n')!==snapshot.text)||snapshot.kind!=='pdf'&&snapshot.pages!==undefined)throw new Error('evaluation_snapshot_payload_invalid');
    if(snapshot.figures!==undefined&&(!Array.isArray(snapshot.figures)||snapshot.figures.some(figure=>typeof figure?.caption!=='string'||typeof figure?.url!=='string')))throw new Error('evaluation_snapshot_figures_invalid');
    for(const figure of snapshot.figures??[])normalizeUrl(figure.url);
    if(snapshot.canonical_url)normalizeUrl(snapshot.canonical_url);
    new EvidenceRegistry([snapshot]);
    result.set(row.sample_id,{...structuredClone(snapshot),requested_url:sample.url});
  }
  return result;
}

export async function readEvaluationVersions(deployment:Deployment,notesRepository:string,implementationRepository=process.cwd()){
  const commit=(await exec('git',['-C',notesRepository,'rev-parse','HEAD'])).stdout.trim();
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('evaluation_skill_commit_invalid');
  const dirty=(await exec('git',['-C',notesRepository,'status','--porcelain','--untracked-files=no'])).stdout;
  if(dirty.trim())throw new Error('evaluation_notes_checkout_dirty');
  const paths=['agent','selection','research','writing','review'];
  const bytes=await Promise.all(paths.map(name=>readFile(join(implementationRepository,'agents/reading',name==='agent'?'agent.md':`prompts/${name}.md`))));
  const policyFiles=Object.fromEntries(await Promise.all(['preferences.yaml','sources.yaml','runtime.yaml'].map(async name=>[name,await readFile(join(implementationRepository,'agents/reading',name),'utf8')])));
  // Match parseTrustedPolicy's existing file-order hash without rewriting historical policy facts.
  return {config:sha256(canonicalJson({deployment:parseDeployment(deployment),policy_hash:sha256(JSON.stringify(policyFiles))})),prompt:sha256(Buffer.concat(bytes)),model:deployment.model,skill_commit:commit};
}
/** A local proposal is insufficient: resolve the notes remote default branch and prove ancestry. */
export async function verifyPublishedSkill(notesRepository:string,skillCommit:string):Promise<void>{
  try{
    const remote=(await exec('git',['-C',notesRepository,'remote','get-url','origin'])).stdout.trim();
    if(!/^(?:https:\/\/github\.com\/|git@github\.com:)unirain\/obs-notes-hub(?:\.git)?\/?$/.test(remote))throw new Error('untrusted_notes_remote');
    const metadata=(await exec('git',['-C',notesRepository,'ls-remote','--symref','origin','HEAD'],{timeout:30_000})).stdout;
    if(!/^ref: refs\/heads\/[^\s]+\s+HEAD$/m.test(metadata))throw new Error('remote_default_branch_unknown');
    const head=/^([a-f0-9]{40})\s+HEAD$/m.exec(metadata)?.[1];if(!head)throw new Error('remote_head_unknown');
    await exec('git',['-C',notesRepository,'fetch','--quiet','--no-tags','--no-write-fetch-head','origin',head],{timeout:30_000});
    await exec('git',['-C',notesRepository,'merge-base','--is-ancestor',skillCommit,head]);
  }catch{throw new Error('evaluation_published_skill_unverified');}
}
function validateContext(context:ContextBundle,frozen:Frozen,heldout:ReturnType<typeof heldoutExclusion>,deployment:Deployment){
  const v=frozen.versions;
  if(context.prompt_hash!==v.prompt||context.model!==v.model||context.skill_commit!==v.skill_commit||sha256(canonicalJson({deployment,policy_hash:context.preferences_hash}))!==v.config)throw new Error('evaluation_generation_version_mismatch');
  for(const note of [...context.examples,...context.related_notes])if(heldout.note_paths.has(note.path)||note.sources.some(url=>heldout.urls.has(normalizeUrl(url))))throw new Error('evaluation_holdout_leak');
}
function prediction(project:HostProject|undefined):QualityLabel|null{
  if(!project)return null;
  if(/^(core_material_gap|main_source_unread|main_source_unavailable|unsupported_format)$/.test(project.reason??''))return 'insufficient';
  if(project.classification?.credential?.content_eligibility==='excluded')return 'reject';
  if(project.selection?.decision==='skip')return 'reject';
  if(project.selection?.decision==='defer')return 'insufficient';
  if(project.selection?.decision==='research')return 'collect';
  return null;
}

/** Each sample owns an immutable preview namespace and retains the normal invocation/recovery ledger. */
export async function executeEvaluation(options:ExecuteEvaluationOptions):Promise<EvaluationExecution>{
  const frozen=structuredClone(options.frozen);verifyFrozenDataset(frozen);
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(options.session)||!['holdout','development'].includes(options.split))throw new Error('evaluation_session_or_split_invalid');
  const deployment=parseDeployment(options.deployment);
  if(deployment.name!=='preview'||deployment.execution_scope!=='preview'||deployment.image!==null||deployment.github_app_credential_ref!==null||deployment.target_repository!==null)throw new Error('evaluation_preview_only');
  const snapshots=validatedSnapshots(frozen,options.snapshots);
  const actual=await readEvaluationVersions(deployment,options.notes_repository,options.implementation_repository);
  for(const key of ['config','prompt','model','skill_commit'] as const)if(actual[key]!==frozen.versions[key])throw new Error('evaluation_fixed_version_mismatch:'+key);
  const selected=frozen.samples.filter(sample=>sample.split===options.split&&(!options.sample_ids||options.sample_ids.includes(sample.id)));
  if(!selected.length||options.sample_ids&&(new Set(options.sample_ids).size!==options.sample_ids.length||options.sample_ids.some(id=>!selected.some(sample=>sample.id===id))))throw new Error('evaluation_sample_selection_invalid');
  const env=options.env??process.env,layer=options.replay?'local_replay':'live';
  if(!options.replay){await assertG1Evidence(env.READING_G1_EVIDENCE_PATH,env.READING_G1_EVIDENCE_SHA256);await verifyPublishedSkill(options.notes_repository,frozen.versions.skill_commit);}
  const heldout=heldoutExclusion(frozen.samples);
  for(const sample of frozen.samples.filter(sample=>sample.split==='holdout')){
    const snapshot=snapshots.get(sample.id)!;
    for(const url of [sample.url,snapshot.url,snapshot.requested_url,...(snapshot.canonical_url?[snapshot.canonical_url]:[])])if(url)heldout.urls.add(normalizeUrl(url));
  }
  const exclusion={urls:[...heldout.urls].sort(),note_paths:[...heldout.note_paths].sort()};
  const cases:EvaluationCase[]=[],startedAt=env.READING_JOB_STARTED_AT?Number(env.READING_JOB_STARTED_AT):Date.now();
  for(const sample of selected){
    if(options.abort_signal?.aborted)break;
    const snapshot=snapshots.get(sample.id)!;
    const previewId='eval_'+sha256(canonicalJson([options.session,sample.id])).slice(0,32);
    const dispatch=parseDispatch({mode:'preview',preview_id:previewId,input_urls:[sample.url]});
    const binding={schema_version:1,frozen_hash:frozen.frozen_hash,samples_hash:frozen.versions.samples_hash,session:options.session,layer,split:options.split,sample_id:sample.id,source_id:sample.source_id,url:sample.url,source_snapshot_hash:snapshot.hash,snapshot_document_hash:sha256(canonicalJson(snapshot)),versions:actual,exclusion};
    const attemptedAt=new Date().toISOString();
    const application=await (options.replay?.build??buildApplication)({deployment,dispatch,notes_repository:resolve(options.notes_repository),implementation_repository:resolve(options.implementation_repository??process.cwd()),local_root:resolve(options.local_root??'.reading-local/quality'),env,abort_signal:options.abort_signal,started_at:startedAt,run_id:'evaluation_'+randomUUID(),heldout,
      fixed_primary_snapshot:async url=>{if(normalizeUrl(url)!==normalizeUrl(sample.url))throw new Error('evaluation_primary_url_mismatch');return {...structuredClone(snapshot),requested_url:url};},
      validate_generation_context:context=>validateContext(context,frozen,heldout,deployment),
    });
    const {journal}=application;
    const previous=await journal.load<unknown>('evaluations/plan');
    if(previous&&canonicalJson(previous)!==canonicalJson(binding))throw new Error('evaluation_resume_binding_mismatch');
    if(!previous){
      if(journal.keys('projects/').length||journal.keys('invocations/').length)throw new Error('evaluation_namespace_not_empty');
      const identity=(await journal.load<IdentityState>('identity'))??emptyIdentity();
      addCandidate(identity,discoverCandidate(sample.source_id,sample.url,sample.title??null,null,new Date().toISOString()));
      await journal.commitMany({'evaluations/plan':binding,identity},'evaluation_inputs_fixed');
    }
    await journal.commit('evaluations/attempts/'+journal.run_id,{schema_version:1,run_id:journal.run_id,started_at:attemptedAt});
    await application.controller.run(dispatch,'quality-evaluation');
    const projects=await Promise.all(journal.keys('projects/').map(key=>journal.load<HostProject>(key)));
    if(projects.length>1)throw new Error('evaluation_multiple_projects_unexpected');
    const project=projects[0];
    if(project){validateContext(project.context,frozen,heldout,deployment);if(project.candidate.url!==normalizeUrl(sample.url)||project.snapshots.some(body=>(normalizeUrl(body.requested_url??body.url)===normalizeUrl(sample.url))&&body.hash!==snapshot.hash))throw new Error('evaluation_result_binding_mismatch');}
    const reports:RunReport[]=[];
    for(const key of journal.keys('runs/'))reports.push(parseRunReport(await journal.load(key)));
    reports.sort((a,b)=>a.started_at.localeCompare(b.started_at)||a.run_id.localeCompare(b.run_id));
    const attempts=new Map<string,{schema_version:1;run_id:string;started_at:string}>();
    for(const key of journal.keys('evaluations/attempts/')){const attempt=await journal.load<{schema_version:1;run_id:string;started_at:string}>(key);if(!attempt||attempt.schema_version!==1||Object.keys(attempt).some(key=>!['schema_version','run_id','started_at'].includes(key))||key!=='evaluations/attempts/'+attempt.run_id)throw new Error('evaluation_attempt_record_invalid');assertUtcInstant(attempt.started_at,'evaluation attempt start');attempts.set(attempt.run_id,attempt);}
    const incomplete=[...attempts.keys()].some(id=>!reports.some(report=>report.run_id===id))||reports.some(report=>!attempts.has(report.run_id));
    // RunReport starts at the shared job deadline origin. Per-case elapsed time starts at its own attempt.
    const duration=reports.reduce((sum,report)=>{const attempt=attempts.get(report.run_id);if(!attempt)return sum;const elapsed=Date.parse(report.finished_at)-Date.parse(attempt.started_at);if(elapsed<0)throw new Error('evaluation_duration_invalid');return sum+elapsed;},0);
    if(!Number.isSafeInteger(duration)||duration<0)throw new Error('evaluation_duration_invalid');
    const result:EvaluationCase={schema_version:1,sample_id:sample.id,workspace_id:journal.handle.workspace_id,revision:journal.handle.revision,project_id:project?.project_id??null,state:project?.state??'not_started',reason:project?.reason??null,predicted:prediction(project),source_snapshot_hash:snapshot.hash,context_id:project?.context.context_id??null,versions:reports.flatMap(report=>report.versions.projects).filter((version,index,all)=>all.findIndex(other=>other.context_id===version.context_id)===index),run_ids:reports.map(report=>report.run_id),run_records:reports.map(report=>({run_id:report.run_id,input_commit:report.input_commit,implementation_commit:report.versions.implementation_commit,policy_check_refs:report.policy_check_refs})),invocation_facts:journal.keys('invocations/').map(key=>{const invocation=journal.handle.records[key] as unknown as InvocationRecord;return {invocation_id:invocation.invocation_id,input_hash:invocation.input_hash,context_hash:invocation.context_hash,messages:invocation.messages.map(message=>({message_id:message.message_id,sha256:sha256(canonicalJson(message))}))};}),usage:buildUsageLedger([journal.handle]).total,known_duration_ms:duration,duration_ms:incomplete?null:duration,failures:reports.flatMap(report=>report.failures),artifact_hashes:Object.fromEntries(journal.handle.snapshot.manifest.files.filter(file=>file.role==='artifact'||file.role==='report').map(file=>[file.path,file.sha256])),checks:{formal_upload:'not_exercised',formal_url:'not_exercised',github_pr:'not_exercised'}};
    await journal.commit('evaluations/result',result);
    cases.push(result);
  }
  // Execution does not fill human scores, PR facts or qualified status from model output.
  const samples=frozen.samples.map(sample=>{const result=cases.find(result=>result.sample_id===sample.id);return {...sample,predicted:result?.predicted??null,model_review_passed:result?.state==='preview_ready'?true:result?.state==='deferred'&&result.reason==='quality_blocked'?false:null,cost_usd:result?.usage.cost_usd??null,known_cost_usd:result?.usage.known_cost_usd??null,duration_ms:result?.duration_ms??null,known_duration_ms:result?.known_duration_ms??null,execution_scope:result?'preview' as const:null,qualified:false,human_claims_supported:null,human_claims_checked:null,numeric_errors:null,interface_errors:null,link_errors:null,mechanism_score:null,tradeoff_score:null,boundary_score:null,figure_score:null,feedback:null};});
  return {schema_version:1,frozen_hash:frozen.frozen_hash,session:options.session,layer,split:options.split,samples,cases,quality_gate:'awaiting_user_confirmation',model_version_status:'identifier_only_unverified'};
}

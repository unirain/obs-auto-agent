import {it,expect,afterEach} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256,canonicalJson} from '../../src/contracts/index.js';
import {buildApplication,type BuildApplicationOptions} from '../../src/app/bootstrap.js';
import type {HostProject} from '../../src/app/controller.js';
import type {ModelAdapter} from '../../src/runtime/sdk.js';
import {readInstalledSdkVersion} from '../../src/runtime/versions.js';
import {READING_CLOUD_CONTRACT} from '../../src/tools/skills.js';
import {parseDeployment} from '../../src/config/deployment.js';
import {indexNote,buildContext} from '../../src/context/index.js';
import {mergeEvaluationExecutions} from './aggregate.js';
import {heldoutExclusion,freezeDataset,type LabeledSample} from './evaluation.js';
import {executeEvaluation,readEvaluationVersions,validatedSnapshots,verifyPublishedSkill,type ExecuteEvaluationOptions,type SnapshotDocument} from './execute.js';
const exec=promisify(execFile),roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(async root=>{await exec('chmod',['-R','u+rwX',root]);await rm(root,{recursive:true,force:true});}));});

async function fixture(unknown=false,selection?:'research'|'skip'|'defer',priced=false){
 const root=await mkdtemp(join(tmpdir(),'quality-execution-'));roots.push(root);
 const notes=join(root,'notes');
 const marker='<!-- reading-agent-cloud-contract: obs-reading-agent-cloud/v1 -->\n';
 for(const [path,body] of Object.entries({
  '.agents/skills/obsidian-note/SKILL.md':marker+'VAULT_ROOT immutable notes.',
  '.agents/skills/fireworks-tech-graph/SKILL.md':marker+'Fixed tools.',
  '.agents/skills/obsidian-note/references/diagram-playbook.md':marker+'Diagram rules.',
  '.agents/skills/obsidian-note/references/reading-agent-cloud-contract.json':JSON.stringify(READING_CLOUD_CONTRACT),
  'Organize Notes By AI/261014-excluded.md':'---\ntitle: agent excluded\ncreated: 2026-10-14\nsource: https://blog.langchain.com/0?utm_source=copy\n---\n# Agent SHOULD_NOT_BE_RECALLED\nSHOULD_NOT_BE_RECALLED',
  'Organize Notes By AI/261013-development.md':'---\ntitle: agent practice\ncreated: 2026-10-13\nsource: https://example.org/development\n---\n# Agent\nCONTROL_EXAMPLE agent practice',
 })){await mkdir(join(notes,path,'..'),{recursive:true});await writeFile(join(notes,path),body);}
 await exec('git',['init',notes]);await exec('git',['-C',notes,'add','.']);await exec('git',['-C',notes,'-c','user.name=Test','-c','user.email=test@example.org','commit','-m','test-fixed-input']);
 const deployment=parseDeployment(JSON.parse(await readFile('agents/reading/deploy/examples/preview.json','utf8')));
 const versions=await readEvaluationVersions(deployment,notes);
 const rows: LabeledSample[]=Array.from({length:30},(_,i)=>({id:String(i),url:`https://blog.langchain.com/${i}`,title:'agent',source_id:i%2?'langchain_blog':'claude_resources',note_paths:[],human_label:'collect',predicted:null,split:i<10?'holdout':'development',human_claims_supported:null,human_claims_checked:null,model_review_passed:null,numeric_errors:null,interface_errors:null,link_errors:null,mechanism_score:null,tradeoff_score:null,boundary_score:null,figure_score:null,feedback:null,cost_usd:null,duration_ms:null,qualified:false,source_snapshot_hash:sha256('We are launching a new product today '+i)}));
 const frozen=freezeDataset(rows,versions);
 const snapshots:SnapshotDocument={schema_version:1,snapshots:rows.map((row,i)=>({sample_id:row.id,snapshot:{url:row.url,requested_url:row.url,text:'We are launching a new product today '+i,hash:row.source_snapshot_hash!,retrieved_at:'2026-10-13T00:00:00Z',links:[],kind:'web'}}))};
 const files={
  'preferences.yaml':await readFile('agents/reading/preferences.yaml','utf8'),
  'sources.yaml':await readFile('agents/reading/sources.yaml','utf8'),
  'runtime.yaml':await readFile('agents/reading/runtime.yaml','utf8'),
 };
 let calls=0,transports=0;
 const journals:Awaited<ReturnType<typeof buildApplication>>['journal'][]=[];
 const model:ModelAdapter={async *stream(request){
  calls++;
  expect(request.prompt+request.system_prompt).not.toContain('human_label');
  expect(request.prompt).not.toContain('SHOULD_NOT_BE_RECALLED');
  const current=await request.tools.find(tool=>tool.name==='read_related_summary')!.run({});
  expect(JSON.stringify(current)).not.toContain('SHOULD_NOT_BE_RECALLED');
  const text=(await request.tools.find(tool=>tool.name==='read_main')!.run({}) as {lines:{text:string}[]}).lines[0]!.text;
  expect(text).toBe('We are launching a new product today 0');
  if(unknown){yield {message_id:'paid-step',type:'assistant',summary:false,usage:{input_tokens:75,output_tokens:7,cost_usd:null,cost_status:'unknown'},observable:{}};throw new Error('simulated response lost');}
  const classified={content_eligibility:selection?'allowed':'excluded',content_type:selection?'engineering_practice':'product_announcement',topic:'agent',reason_codes:selection?[]:['product_announcement'],evidence:[{start_line:1,end_line:1,excerpt:text}]};
  if(selection&&calls>2)throw new Error('research response lost');
  const result=selection&&calls===2?{decision:selection,reason_codes:[selection==='defer'?'insufficient_material':'knowledge_increment'],reason:'Fixed replay selection',dimension_ratings:{relevance:'strong',mechanism:'strong',evidence:selection==='defer'?'unknown':'strong',transferability:'strong',increment:'strong'},questions:['How does this work?'],related_note_ids:[],evidence_ids:[]}:classified;
  if(priced)yield {message_id:'step-'+calls,type:'assistant',summary:false,usage:{input_tokens:10,output_tokens:2,cost_usd:1,cost_status:'known'},observable:{}};
  yield {message_id:'result-'+calls,type:'result',summary:true,success:true,usage:{input_tokens:20,output_tokens:5,cost_usd:priced?2:null,cost_status:priced?'known':'unknown'},result,observable:{}};
 }};
 const options:ExecuteEvaluationOptions={frozen,snapshots,deployment,session:'frozen_fixture',split:'holdout',sample_ids:['0'],notes_repository:notes,local_root:join(root,'workspace'),env:{},replay:{build:async(options:BuildApplicationOptions)=>{
  const application=await buildApplication({...options,local:true,policy_source:{readSnapshot:async()=>({commit:'a'.repeat(40),files})},model_adapter:model,runtime_versions_provider:async()=>({...await readInstalledSdkVersion(),tools_image_id:'sha256:'+'0'.repeat(64),tools_manifest_hash:'0'.repeat(64)}),gateway_resolver:async()=>[{address:'8.8.8.8',family:4}],gateway_transport:async()=>{transports++;throw new Error('frozen main must not fetch live');}});
  journals.push(application.journal);return application;
 }}};
 return {options,root,notes,journals,policy_files:files,calls:()=>calls,transports:()=>transports};
}

it('executes a label-blind fixed body through the real host and cold reuses classification, excluding heldout notes from examples and live recall',async()=>{
 const f=await fixture();
 const first=await executeEvaluation(f.options);
 expect(first).toMatchObject({layer:'local_replay',quality_gate:'awaiting_user_confirmation',cases:[{state:'skipped',predicted:'reject',usage:{invocation_count:1,cost_usd:null,unknown_invocations:1},checks:{github_pr:'not_exercised',formal_upload:'not_exercised',formal_url:'not_exercised'}}]});
 expect(first.samples[0]).toMatchObject({human_label:'collect',predicted:'reject',qualified:false,human_claims_supported:null,mechanism_score:null,feedback:null});
 expect(first.samples[10]!.predicted).toBeNull();
 expect(first.cases[0]!.run_records[0]!.input_commit).toBe('a'.repeat(40));expect(first.cases[0]!.run_records[0]!.policy_check_refs.length).toBeGreaterThan(0);
 const plan=await f.journals[0]!.load('evaluations/plan');expect(JSON.stringify(plan)).not.toContain('human_label');
 const fixed=await f.journals[0]!.load<HostProject>(f.journals[0]!.keys('projects/')[0]!);
 expect(fixed!.context.examples.map(note=>note.path)).toEqual(['Organize Notes By AI/261013-development.md']);
 expect(fixed!.snapshots[0]!.text).toBe('');expect(fixed!.snapshots[0]!.body_reference).toBeDefined();
 const invocation=await f.journals[0]!.load('invocations/'+f.journals[0]!.keys('invocations/')[0]!.split('/')[1]);
 const second=await executeEvaluation(f.options);
 expect(f.calls()).toBe(1);expect(f.transports()).toBe(0);
 expect(second.cases[0]!.project_id).toBe(first.cases[0]!.project_id);expect(second.cases[0]!.usage).toEqual(first.cases[0]!.usage);
 expect(second.cases[0]!.run_ids).toHaveLength(2);
 expect(await f.journals[1]!.load(f.journals[1]!.keys('invocations/')[0]!)).toEqual(invocation);
});

it.each([['research','collect'],['skip','reject'],['defer','insufficient']] as const)('records actual %s selection as %s without treating unfinished research as qualified',async(decision,predicted)=>{
 const f=await fixture(false,decision);const result=await executeEvaluation(f.options);
 expect(result.cases[0]!.predicted).toBe(predicted);expect(result.samples[0]).toMatchObject({predicted,qualified:false,cost_usd:null});
 if(decision==='research'){expect(result.cases[0]).toMatchObject({state:'deferred',reason:'request_unknown',usage:{invocation_count:3,unresolved_invocations:1}});expect(f.calls()).toBe(3);}else expect(f.calls()).toBe(2);
});

it('preserves a paid unknown query and its charges on cold rerun without a new model call or fabricated prediction',async()=>{
 const f=await fixture(true);const first=await executeEvaluation(f.options);
 expect(first.cases[0]).toMatchObject({state:'deferred',reason:'request_unknown',predicted:null,usage:{input_tokens:75,output_tokens:7,cost_usd:null,unresolved_invocations:1,invocation_count:1}});
 const before=await f.journals[0]!.load(f.journals[0]!.keys('invocations/')[0]!);
 const cold=await executeEvaluation(f.options);expect(f.calls()).toBe(1);expect(cold.cases[0]!.usage).toEqual(first.cases[0]!.usage);
 expect(await f.journals[1]!.load(f.journals[1]!.keys('invocations/')[0]!)).toEqual(before);
 expect(cold.samples[0]).toMatchObject({predicted:null,cost_usd:null,qualified:false});
});

it('rejects changed fixed bodies, versions, sample selection and missing G1 before constructing an application',async()=>{
 const f=await fixture();let builds=0;const replay={build:async()=>{builds++;throw new Error('unexpected application construction');}};
 const body=structuredClone(f.options.snapshots);body.snapshots[0]!.snapshot.text='different body';
 await expect(executeEvaluation({...f.options,snapshots:body,replay})).rejects.toThrow('snapshot_binding');
 for(const field of ['config','prompt','model','skill_commit'] as const){const versions={...f.options.frozen.versions,[field]:field==='model'?'different-model':field==='skill_commit'?'b'.repeat(40):sha256('different')};const frozen=freezeDataset(f.options.frozen.samples,versions);await expect(executeEvaluation({...f.options,frozen,replay})).rejects.toThrow('evaluation_fixed_version_mismatch');}
 await expect(executeEvaluation({...f.options,sample_ids:['10'],replay})).rejects.toThrow('sample_selection');
 await expect(executeEvaluation({...f.options,replay:undefined})).rejects.toThrow('G1 live evidence is not configured');
 expect(builds).toBe(0);expect(f.journals).toHaveLength(0);
});

it('refuses a changed labeled corpus in the same preview session while preserving the original result and invocation',async()=>{
 const f=await fixture();await executeEvaluation(f.options);
 const before=await f.journals[0]!.load('evaluations/result'),revision=f.journals[0]!.handle.revision;
 const changed=structuredClone(f.options.frozen.samples);changed[0]!.human_label='reject';
 await expect(executeEvaluation({...f.options,frozen:freezeDataset(changed,f.options.frozen.versions)})).rejects.toThrow('evaluation_resume_binding_mismatch');
 expect(f.calls()).toBe(1);expect(f.journals[1]!.handle.revision).toBe(revision);expect(await f.journals[1]!.load('evaluations/result')).toEqual(before);
});

it('rejects changed actual generation policy on a fresh session before any model query while fixed frozen versions remain unchanged',async()=>{
 const f=await fixture();await executeEvaluation(f.options);const original=f.options.frozen.frozen_hash;
 f.policy_files['preferences.yaml']+='\n# changed generation configuration\n';
 await expect(executeEvaluation({...f.options,session:'new_session_with_same_freeze'})).rejects.toThrow('evaluation_generation_version_mismatch');
 expect(f.calls()).toBe(1);expect(f.options.frozen.frozen_hash).toBe(original);expect(f.journals[1]!.keys('invocations/')).toEqual([]);
 expect(f.journals[1]!.keys('projects/')).toEqual([]);
});

it('validates PDF pages using the runtime body contract and excludes tracking variants in fixed examples',async()=>{
 const f=await fixture();const frozen=structuredClone(f.options.frozen.samples),document=structuredClone(f.options.snapshots);
 const snapshot=document.snapshots[0]!.snapshot;snapshot.kind='pdf';snapshot.pages=['page one','page two'];snapshot.text=snapshot.pages.join('\n\f\n');snapshot.hash=sha256(snapshot.text);frozen[0]!.source_snapshot_hash=snapshot.hash;
 expect(validatedSnapshots(freezeDataset(frozen,f.options.frozen.versions),document).get('0')!.pages).toHaveLength(2);
 snapshot.pages[1]='changed';expect(()=>validatedSnapshots(freezeDataset(frozen,f.options.frozen.versions),document)).toThrow('payload_invalid');
 const note=indexNote({path:'Organize Notes By AI/261014-track.md',commit:'a'.repeat(40),first_added_at:'2026-10-14',text:'---\ntitle: agent\nsource: https://blog.langchain.com/0?utm_source=tracker\n---\n# agent\nexcluded'});
 const context=buildContext({index:[note],query:'agent',heldout:heldoutExclusion(f.options.frozen.samples),preferences_hash:sha256('p'),skill_commit:'a'.repeat(40),skill_hash:sha256('s'),prompt_hash:sha256('t'),model:'m',evidence_versions:[]});
 expect(context.examples).toEqual([]);expect(context.related_notes).toEqual([]);
});

it('reconciles a lost execution return from committed run facts, and keeps missing attempt durations unknown',async()=>{
 const f=await fixture();const build=f.options.replay!.build;let interrupted=false;
 const replay={build:async(options:BuildApplicationOptions)=>{const app=await build(options);if(!interrupted){const run=app.controller.run.bind(app.controller);app.controller.run=async(dispatch,actor)=>{await run(dispatch,actor);interrupted=true;throw new Error('execution return lost');};}return app;}};
 await expect(executeEvaluation({...f.options,replay})).rejects.toThrow('execution return lost');
 expect(f.calls()).toBe(1);expect(await f.journals[0]!.load('evaluations/result')).toBeUndefined();
 await f.journals[0]!.commit('evaluations/attempts/interrupted-no-report',{schema_version:1,run_id:'interrupted-no-report',started_at:new Date().toISOString()});
 const recovered=await executeEvaluation(f.options);expect(f.calls()).toBe(1);
 expect(recovered.cases[0]).toMatchObject({state:'skipped',predicted:'reject',duration_ms:null,usage:{invocation_count:1,cost_usd:null}});
 expect(recovered.cases[0]!.known_duration_ms).toBeGreaterThanOrEqual(0);expect(recovered.samples[0]!.duration_ms).toBeNull();
 await expect(verifyPublishedSkill(f.notes,f.options.frozen.versions.skill_commit)).rejects.toThrow('evaluation_published_skill_unverified');
});

it('actual host execution and aggregate preserve whole-query priced summaries beside an unknown research query and interrupted duration',async()=>{
 const f=await fixture(false,'research',true);const first=await executeEvaluation(f.options);
 expect(f.calls()).toBe(3);expect(first.cases[0]!.usage).toMatchObject({invocation_count:3,unresolved_invocations:1,cost_usd:null,known_cost_usd:4});
 expect(first.samples[0]).toMatchObject({cost_usd:null,known_cost_usd:4,execution_scope:'preview'});
 await f.journals[0]!.commit('evaluations/attempts/interrupted-no-report',{schema_version:1,run_id:'interrupted-no-report',started_at:new Date().toISOString()});
 const cold=await executeEvaluation(f.options);expect(f.calls()).toBe(3);expect(cold.samples[0]).toMatchObject({cost_usd:null,known_cost_usd:4,duration_ms:null,execution_scope:'preview'});
 expect(cold.samples[0]!.known_duration_ms).toBeGreaterThan(0);
 const merged=mergeEvaluationExecutions(f.options.frozen,[first,cold]);expect(merged.samples[0]).toMatchObject({cost_usd:null,known_cost_usd:4,duration_ms:null,known_duration_ms:cold.cases[0]!.known_duration_ms,execution_scope:'preview'});
 expect(merged.cases).toHaveLength(1);expect(merged.cases[0]!.usage.invocation_count).toBe(3);
},60_000);

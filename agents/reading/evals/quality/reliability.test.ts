import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sha256} from '../../src/contracts/index.js';
import {buildUsageLedger} from '../../src/workspace/usage.js';
import {parseRunReport,type RunReport} from '../../src/app/run-records.js';
import type {DeliveryRecord} from '../../src/publish/types.js';
import {freezeDataset,type LabeledSample} from './evaluation.js';
import {reliabilityReport,type ReliabilityInput} from './reliability.js';
const exec=promisify(execFile),at='2026-10-15T00:00:00Z';
function fixture(){
 const rows:LabeledSample[]=Array.from({length:30},(_,index)=>({id:String(index),url:`https://example.org/${index}`,source_id:index%2?'langchain_blog':'claude_resources',note_paths:[],human_label:'collect',predicted:'collect',split:index<10?'holdout':'development',human_claims_supported:null,human_claims_checked:null,model_review_passed:null,numeric_errors:null,interface_errors:null,link_errors:null,mechanism_score:null,tradeoff_score:null,boundary_score:null,figure_score:null,feedback:null,cost_usd:null,duration_ms:null,qualified:false,source_snapshot_hash:sha256('body '+index)}));
 return freezeDataset(rows,{config:sha256('config'),prompt:sha256('prompt'),model:'deepseek-flash',skill_commit:'a'.repeat(40)});
}
function report(id:string,outcome:RunReport['outcome']='partial'):RunReport{return parseRunReport({schema_version:1,run_id:id,logical_key:'reading:2026-10-15',workspace_id:'obs-notes-hub/reading-integration',execution_scope:'production',mode:'scheduled',input_commit:null,versions:{implementation_commit:null,projects:[]},policy_check_refs:[],started_at:at,finished_at:at,outcome,source_results:[{source_id:'langchain_blog',status:'failed',reason_code:'source_http_503',attempted_at:at,last_success_at:null,cursor_before:null,cursor_after:null,coverage:null,coverage_gap:null,unsupported:[]}],project_ids:[],usage:buildUsageLedger([]).total,failures:[],delivery_results:[],blocked_projects:[]});}
function delivery(id:string,url:string):DeliveryRecord{return {schema_version:1,delivery_id:id,project_id:'same_project',generation_version:1,branch:'notes/same_project/g1',status:'awaiting_review',prepared:null,pr:{number:id==='d1'?1:2,url,state:'open',branch:'notes/same_project/g1',head_sha:'a'.repeat(40),delivery_id:id},uncertain_action:null,reason:null,updated_at:at};}
function input(frozen:ReturnType<typeof fixture>):ReliabilityInput{return {schema_version:1,frozen_hash:frozen.frozen_hash,expected_run_ids:null,run_reports:[],expected_delivery_ids:null,deliveries:[],observed_lost_candidates:[]};}
it('absent reliability evidence remains unknown rather than zero and source completeness is never inferred',()=>{
 const frozen=fixture(),result=reliabilityReport(frozen);expect(result.duplicate_prs).toMatchObject({count:null,known_incidents:null});expect(result.source_failures_reported_empty).toMatchObject({count:null,known_incidents:null,audited_collection_runs:0});expect(result.lost_candidates).toEqual({count:null,status:'unknown',reason:'source_completeness_unverified',known_incidents:null,observations:[]});
});
it('explicit complete RunReport audit counts the failed-source/empty contradiction and preserves its run/source/reason evidence',()=>{
 const frozen=fixture(),evidence=input(frozen);evidence.expected_run_ids=['failed-but-partial','false-empty'];evidence.run_reports=[report('failed-but-partial'),report('false-empty','success_no_selection')];const result=reliabilityReport(frozen,evidence);
 expect(result.source_failures_reported_empty).toMatchObject({count:1,known_incidents:1,audited_collection_runs:2,failed_source_observations:2,instances:[{run_id:'false-empty',source_id:'langchain_blog',reason_code:'source_http_503',outcome:'success_no_selection',reported_empty:true}]});expect(result.source_failures_reported_empty.evidence).toHaveLength(2);expect(result.source_failures_reported_empty.evidence[0]!.sha256).toHaveLength(64);
 evidence.run_reports=[report('failed-but-partial')];expect(reliabilityReport(frozen,evidence).source_failures_reported_empty).toMatchObject({count:null,known_incidents:0,audit:{missing_ids:['false-empty']}});
 evidence.expected_run_ids=['failed-but-partial'];expect(reliabilityReport(frozen,evidence).source_failures_reported_empty.count).toBe(0);
 const noSources=report('missing-source-records');noSources.source_results=[];evidence.expected_run_ids=[noSources.run_id];evidence.run_reports=[noSources];expect(reliabilityReport(frozen,evidence).source_failures_reported_empty.count).toBeNull();
});
it('confirmed delivery audit counts distinct duplicate PR identities, while missing or uncertain remote records keep total unknown',()=>{
 const frozen=fixture(),evidence=input(frozen);evidence.expected_delivery_ids=['d1','d2'];evidence.deliveries=[delivery('d1','https://github.com/test/repo/pull/1'),delivery('d2','https://github.com/test/repo/pull/2')];expect(reliabilityReport(frozen,evidence).duplicate_prs).toMatchObject({count:1,known_incidents:1,unconfirmed_deliveries:0});
 evidence.deliveries.pop();expect(reliabilityReport(frozen,evidence).duplicate_prs).toMatchObject({count:null,audit:{missing_ids:['d2']}});
 evidence.expected_delivery_ids=['d1'];evidence.deliveries[0]!.pr=null;evidence.deliveries[0]!.status='publishing';evidence.deliveries[0]!.uncertain_action='create_pr';expect(reliabilityReport(frozen,evidence).duplicate_prs).toMatchObject({count:null,known_incidents:null,unconfirmed_deliveries:1});
});
it('human-observed lost candidate is a frozen-case-bound lower count only; zero cannot claim source completeness',()=>{
 const frozen=fixture(),evidence=input(frozen);evidence.observed_lost_candidates=[{sample_id:'0',evidence_reference:'local://audit/fixed-receipt-versus-candidate'}];expect(reliabilityReport(frozen,evidence).lost_candidates).toMatchObject({count:null,status:'unknown',known_incidents:1});
 evidence.observed_lost_candidates[0]!.sample_id='not-in-frozen-corpus';expect(()=>reliabilityReport(frozen,evidence)).toThrow('loss_evidence_invalid');evidence.observed_lost_candidates[0]!.sample_id='0';evidence.observed_lost_candidates[0]!.evidence_reference='';expect(()=>reliabilityReport(frozen,evidence)).toThrow('loss_evidence_invalid');
 const forged={...input(frozen),lost_candidates:0};expect(()=>reliabilityReport(frozen,forged)).toThrow('input_invalid');
});
it('reliability import rejects changed frozen identity, duplicate/missing-shaped evidence and malformed stored run records',()=>{
 const frozen=fixture(),evidence=input(frozen);evidence.frozen_hash=sha256('other');expect(()=>reliabilityReport(frozen,evidence)).toThrow('frozen_binding_mismatch');evidence.frozen_hash=frozen.frozen_hash;evidence.run_reports=[report('same'),report('same')];expect(()=>reliabilityReport(frozen,evidence)).toThrow('duplicate_record');evidence.run_reports=[{...report('invalid'),outcome:'not_an_outcome'} as unknown as RunReport];expect(()=>reliabilityReport(frozen,evidence)).toThrow('Invalid run report');
});
it('report CLI includes validated reliability measurements and keeps unmeasured source loss unknown without any live execution',async()=>{
 const frozen=fixture(),evidence=input(frozen),root=await mkdtemp(join(tmpdir(),'quality-reliability-'));try{
  evidence.expected_run_ids=['observed-empty'];evidence.run_reports=[report('observed-empty','success_no_selection')];const frozenPath=join(root,'frozen.json'),measured=join(root,'measured.json'),evidencePath=join(root,'reliability.json'),output=join(root,'report.json');await writeFile(frozenPath,JSON.stringify(frozen));await writeFile(measured,JSON.stringify({samples:frozen.samples}));await writeFile(evidencePath,JSON.stringify(evidence));
  await exec('npx',['tsx','agents/reading/evals/quality/run.ts','report','--input',measured,'--frozen',frozenPath,'--reliability',evidencePath,'--output',output]);const actual=JSON.parse(await readFile(output,'utf8'));expect(actual).toMatchObject({quality_gate:'awaiting_user_confirmation',reliability:{frozen_hash:frozen.frozen_hash,lost_candidates:{count:null,known_incidents:null},source_failures_reported_empty:{count:1,instances:[{run_id:'observed-empty',source_id:'langchain_blog'}]}}});
 }finally{await rm(root,{recursive:true,force:true});}
});

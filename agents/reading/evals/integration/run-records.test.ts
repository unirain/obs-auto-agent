import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal} from '../../src/app/journal.js';
import {parseRunReport,type RunReport} from '../../src/app/run-records.js';
import {validateHostRecords} from '../../src/app/records.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {policyFixture,subjectFixture} from '../runtime/policy-fixtures.js';
import {buildUsageLedger,usageForRun} from '../../src/workspace/usage.js';
import {sha256,type JsonValue} from '../../src/contracts/index.js';
async function setup(){const root=await mkdtemp(join(tmpdir(),'run-record-contract-'));const store=new FileObjectStore(join(root,'objects'));const options={store,scope:'production' as const,local_root:join(root,'warm'),record_validator:validateHostRecords,verify_preflight:false};const manager=new ImmutableWorkspaceManager(options);const journal=new WorkspaceJournal(manager,await manager.restore('obs-notes-hub/reading',{allow_initialize:true}),'run1');const report:RunReport={schema_version:1,run_id:'run1',logical_key:'obs-notes-hub:reading:2026-10-13',workspace_id:journal.handle.workspace_id,execution_scope:'production',mode:'scheduled',input_commit:null,versions:{implementation_commit:null,projects:[]},policy_check_refs:[],started_at:'2026-10-13T00:00:00Z',finished_at:'2026-10-13T00:01:00Z',outcome:'success_no_selection',source_results:[],project_ids:[],usage:usageForRun(buildUsageLedger([journal.handle]),'production',journal.handle.workspace_id,'run1'),failures:[],delivery_results:[],blocked_projects:[]};return {root,store,options,manager,journal,report};}
it('a full run preserves unknown provenance, measured usage detail and committed policy references across a cold restart',async()=>{const f=await setup();try{
 const gate=new PolicyGate(async()=>policyFixture(),check=>f.journal.commit('policy-checks/'+check.check_id,check),()=>new Date(f.report.started_at));const check=await gate.require(subjectFixture(),'main_read','source_request');f.report.policy_check_refs=[check.check_id];expect(f.journal.committedRecordKeys('policy-checks/')).toEqual(['policy-checks/'+check.check_id]);
 await f.journal.commit('runs/run1',parseRunReport(f.report));const cold=new ImmutableWorkspaceManager({...f.options,local_root:join(f.root,'cold')});const restored=await cold.restore(f.report.workspace_id);const report=parseRunReport(restored.records['runs/run1']);expect(report.versions.implementation_commit).toBeNull();expect(report.input_commit).toBeNull();expect(Object.keys(report.usage)).toHaveLength(11);expect(report.policy_check_refs).toEqual([check.check_id]);
 const next=new WorkspaceJournal(cold,restored,'run2');expect(next.committedRecordKeys('policy-checks/')).toHaveLength(0);await next.commit('policy-checks/'+check.check_id,check);expect(next.committedRecordKeys('policy-checks/')).toEqual(['policy-checks/'+check.check_id]);
 }finally{await rm(f.root,{recursive:true,force:true});}});
it('malformed time, price semantics, mode, legacy shapes and nonexistent policy refs cannot become a committed run',async()=>{const f=await setup();try{
 for(const bad of [{...f.report,finished_at:'2026-02-30T00:01:00Z'},{...f.report,started_at:'2026-10-13'},{...f.report,finished_at:'2026-10-12T00:00:00Z'},{...f.report,mode:'preview'},{...f.report,usage:{...f.report.usage,cost_status:'unknown',cost_usd:0}},{...f.report,unexpected_control:'publish'}])expect(()=>parseRunReport(bad)).toThrow();
 expect(()=>parseRunReport({schema_version:1,run_id:'old'})).toThrow();
 await expect(f.manager.checkpoint(f.journal.handle,{expected_revision:f.journal.handle.revision,run_id:'run1',reason:'run_recorded',records:{'runs/run1':{...f.report,policy_check_refs:[sha256('nonexistent')]} as unknown as JsonValue}})).rejects.toThrow('run_policy_reference_missing');const restored=await f.manager.restore(f.report.workspace_id);expect(restored.records['runs/run1']).toBeUndefined();
 }finally{await rm(f.root,{recursive:true,force:true});}});

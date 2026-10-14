import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {acceptSourceGap,inspectSourceGaps,verifySourceBackfill,type AcceptSourceGapRequest,type VerifySourceBackfillRequest} from '../../src/app/source-gap-management.js';
import {emptySourceHealth,applySourceResult,type SourceHealth} from '../../src/collect/incidents.js';
import {emptySourceProgress,type SourceResult} from '../../src/collect/sources.js';
import {canonicalJson,sha256} from '../../src/contracts/index.js';
import {parseCli} from '../../src/app/cli-options.js';
import {sumUsage} from '../../src/workspace/usage.js';
import {projectEvents} from '../../src/monitor/source-health.js';
const now='2026-10-14T00:00:00.000Z',workspace='obs-notes-hub/reading-integration';
const gapId='claude_resources:source_no_history_pagination:2026-10-01T00:00:00.000Z';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'source-gap-management-')),objects=join(root,'objects');
 const store=new FileObjectStore(objects,100,{versioning:'never',acl:'private',anonymous_readable:false,lifecycle:[],endpoint:'https://oss-cn-beijing.aliyuncs.com'});const manager=(local:string)=>new ImmutableWorkspaceManager({store,scope:'production',trusted_workspace_id:workspace,local_root:join(root,local),record_validator:validateHostRecords});
 const first=manager('first');const journal=new WorkspaceJournal(first,await first.restore(workspace,{allow_initialize:true}),'run1');
 const good:SourceResult={source_id:'claude_resources',status:'success',reason_code:null,attempted_at:now,last_success_at:now,cursor_before:null,cursor_after:null,coverage:{from:'2026-10-01T00:00:00.000Z',to:now},coverage_gap:{from:'2026-10-01T00:00:00.000Z',to:now,reason:'source_no_history_pagination'},unsupported:[]};
 let health=applySourceResult(emptySourceHealth(),{...good,status:'failed',reason_code:'source_http_503',last_success_at:null,coverage_gap:null},workspace,'production',now);
 health=applySourceResult(health,good,workspace,'production',now);
 health.gaps['claude_resources:older_gap:2026-09-01T00:00:00.000Z']={from:'2026-09-01T00:00:00.000Z',to:'2026-09-02T00:00:00.000Z',status:'open'};
 health.events.push({event_id:'source_event_4',position:4,workspace_id:workspace,execution_scope:'production',source_id:'claude_resources',reason_code:'coverage_gap',kind:'coverage_gap',occurred_at:now,gap_id:'claude_resources:older_gap:2026-09-01T00:00:00.000Z'});
 await journal.commitMany({'sources/health':health,'sources/claude_resources/progress':emptySourceProgress()},'source_incidents_reconciled');
 const view=await inspectSourceGaps(journal),gap=view.gaps.find(item=>item.gap_id===gapId)!;
 const request:AcceptSourceGapRequest={schema_version:1,action:'accept_gap',management_id:'human-gap-1',workspace_id:workspace,execution_scope:'production',source_id:'claude_resources',gap_id:gapId,expected_revision:view.expected_revision,expected_gap_hash:gap.expected_gap_hash,reason:'Owner accepts this unavailable historical interval.',evidence_reference:'human-review-20261014',acknowledge_missing_coverage:true};
 const cold=async()=>{await rm(join(root,'first'),{recursive:true,force:true});const fresh=manager('cold');return new WorkspaceJournal(fresh,await fresh.restore(workspace),'run2');};
 return {root,store,journal,request,good,cold};
}
it('trusted gap acceptance commits health, event and human audit together; cold recovery and later reading keep accepted and other unresolved intervals',async()=>{
 const f=await fixture();try{
  const progress=await f.journal.load('sources/claude_resources/progress');
  expect(await acceptSourceGap(f.journal,f.request,'owner',()=>new Date(now))).toMatchObject({status:'applied'});
  const restored=await f.cold(),health=(await restored.load<SourceHealth>('sources/health'))!;
  expect(health.gaps[gapId]?.status).toBe('accepted');expect(Object.values(health.gaps).filter(gap=>gap.status==='open')).toHaveLength(1);
  expect(await restored.load('sources/claude_resources/progress')).toEqual(progress);expect(restored.keys('invocations/')).toEqual([]);
  expect(await restored.load('source-gap-management/human-gap-1')).toMatchObject({schema_version:1,origin:'trusted_management',actor:'owner',request:{reason:f.request.reason,evidence_reference:f.request.evidence_reference},gap_before:{status:'open'},gap_after:{status:'accepted'}});
  const view=projectEvents(health.events.filter(event=>event.reason_code==='coverage_gap'),undefined,false)!;
  expect(view.metadata.unresolved_gaps).toEqual(['claude_resources:older_gap:2026-09-01T00:00:00.000Z']);expect(view.metadata.status).toBe('active');
  const next=applySourceResult(health,{...f.good,coverage_gap:null},workspace,'production','2026-10-14T00:01:00.000Z');
  await restored.commitMany({'sources/health':next},'source_incidents_reconciled');
  expect((await restored.load<SourceHealth>('sources/health'))!.gaps[gapId]?.status).toBe('accepted');
  expect(await acceptSourceGap(restored,f.request,'owner')).toMatchObject({status:'already_applied'});
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('gap commands reject scope, revision, interval, identity and untrusted fill claims before any write',async()=>{
 const f=await fixture();try{
  const count=f.store.calls.filter(call=>call.operation==='create').length,revision=f.journal.handle.revision;
  for(const edit of [{execution_scope:'preview'},{workspace_id:'foreign'},{source_id:'langchain_blog'},{expected_revision:'stale'},{expected_gap_hash:'0'.repeat(64)},{reason:' '},{evidence_reference:' '},{acknowledge_missing_coverage:false},{action:'fill_gap',validated_fill:true},{origin:'issue_comment'}])await expect(acceptSourceGap(f.journal,{...f.request,...edit},'owner')).rejects.toThrow();
  await expect(acceptSourceGap(f.journal,f.request,' ')).rejects.toThrow();
  expect(f.journal.handle.revision).toBe(revision);expect(f.store.calls.filter(call=>call.operation==='create')).toHaveLength(count);
  await acceptSourceGap(f.journal,f.request,'owner');
  await expect(acceptSourceGap(f.journal,{...f.request,reason:'Changed acceptance'},'owner')).rejects.toThrow('identity reused');
  await expect(acceptSourceGap(f.journal,f.request,'other actor')).rejects.toThrow('identity reused');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('lost management reply reconciles the committed audit after cold restart without another acceptance event',async()=>{
 const f=await fixture();try{
  const commit=f.journal.commitMany.bind(f.journal);f.journal.commitMany=async(...args)=>{await commit(...args);throw new Error('management_reply_lost');};
  await expect(acceptSourceGap(f.journal,f.request,'owner')).rejects.toThrow('management_reply_lost');
  const cold=await f.cold(),before=cold.handle.revision;
  expect(await acceptSourceGap(cold,f.request,'owner')).toMatchObject({status:'already_applied'});expect(cold.handle.revision).toBe(before);
  expect((await cold.load<SourceHealth>('sources/health'))!.events.filter(event=>event.kind==='accepted_gap')).toHaveLength(1);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('failed acceptance checkpoint leaves both audit and event absent after cold restart',async()=>{
 const f=await fixture();try{
  f.store.faults.push({operation:'create',kind:'permission'});await expect(acceptSourceGap(f.journal,f.request,'owner')).rejects.toThrow();
  const cold=await f.cold();expect(await cold.load('source-gap-management/human-gap-1')).toBeUndefined();
  const health=(await cold.load<SourceHealth>('sources/health'))!;expect(health.gaps[gapId]?.status).toBe('open');expect(health.events.some(event=>event.kind==='accepted_gap')).toBe(false);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('acceptance revision compare runs inside the shared writer queue and refuses intervening state without losing source facts',async()=>{
 const f=await fixture();try{
  const load=f.journal.load.bind(f.journal);let interfere=true;
  f.journal.load=async<T>(key:string)=>{const value=await load<T>(key);if(key==='sources/health'&&interfere){interfere=false;await f.journal.commitMany({'management/intervening':{schema_version:1,fact:'new host fact'}},'source_incidents_reconciled');}return value;};
  await expect(acceptSourceGap(f.journal,f.request,'owner')).rejects.toThrow('checkpoint_revision_drift');
  const cold=await f.cold();expect(await cold.load('management/intervening')).toMatchObject({fact:'new host fact'});expect(await cold.load('source-gap-management/human-gap-1')).toBeUndefined();
  expect((await cold.load<SourceHealth>('sources/health'))!.gaps[gapId]?.status).toBe('open');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

async function backfillFixture(){
 const f=await fixture();
 await f.journal.commit('sources/claude_resources/result',f.good);
 const view=await inspectSourceGaps(f.journal),gap=view.gaps.find(item=>item.gap_id===gapId)!;
 const request:VerifySourceBackfillRequest={schema_version:1,action:'verify_backfill',verification_id:'verify-history-1',workspace_id:workspace,execution_scope:'production',source_id:'claude_resources',gap_id:gapId,expected_revision:view.expected_revision,expected_gap_hash:gap.expected_gap_hash,evidence_refs:[{record_key:'sources/claude_resources/result',sha256:sha256(canonicalJson(f.good))}]};
 return {...f,verification:request};
}
it('committed successful range coverage is verified as an observation but cannot certify historical completeness or clear a gap across cold restore',async()=>{
 const f=await backfillFixture();try{
  const before=canonicalJson(f.journal.handle.records),revision=f.journal.handle.revision,writes=f.store.calls.filter(call=>call.operation==='create').length;
  const result=await verifySourceBackfill(f.journal,f.verification);
  expect(result).toMatchObject({status:'unverified',can_fill:false,reason_code:'source_history_completeness_unsupported',history_contract:null,observations:[{record_key:'sources/claude_resources/result',status:'success',covers_gap:true}]});
  expect(f.journal.handle.revision).toBe(revision);expect(canonicalJson(f.journal.handle.records)).toBe(before);expect(f.store.calls.filter(call=>call.operation==='create')).toHaveLength(writes);
  const cold=await f.cold();expect(await verifySourceBackfill(cold,f.verification)).toEqual(result);
  const health=(await cold.load<SourceHealth>('sources/health'))!;expect(health.gaps[gapId]!.status).toBe('open');expect(health.events.some(event=>event.kind==='gap_resolved')).toBe(false);expect(projectEvents(health.events.filter(event=>event.reason_code==='coverage_gap'),undefined,false)!.metadata.status).toBe('active');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('backfill verification rejects boolean fill, missing/corrupt/cross-source references, wrong revision and scope without changing persistent source state',async()=>{
 const f=await backfillFixture();try{
  const revision=f.journal.handle.revision,before=canonicalJson(f.journal.handle.records),writes=f.store.calls.filter(call=>call.operation==='create').length;
  for(const edit of [{schema_version:2},{action:'filled',validated_fill:true},{validated_fill:true},{workspace_id:'foreign'},{execution_scope:'preview'},{source_id:'langchain_blog'},{expected_revision:'old'},{expected_gap_hash:'0'.repeat(64)},{evidence_refs:[{record_key:'sources/claude_resources/result',sha256:'0'.repeat(64)}]},{evidence_refs:[{record_key:'runs/absent',sha256:'0'.repeat(64)}]},{evidence_refs:[...f.verification.evidence_refs,...f.verification.evidence_refs]}])await expect(verifySourceBackfill(f.journal,{...f.verification,...edit})).rejects.toThrow();
  expect(f.journal.handle.revision).toBe(revision);expect(canonicalJson(f.journal.handle.records)).toBe(before);expect(f.store.calls.filter(call=>call.operation==='create')).toHaveLength(writes);
  const cold=await f.cold();expect(canonicalJson(cold.handle.records)).toBe(before);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('actual committed run evidence remains insufficient; only the explicit human acceptance event closes that gap while other intervals remain open',async()=>{
 const f=await backfillFixture();try{
  const run={schema_version:1,run_id:'backfill-observed',logical_key:'observed-source-range',workspace_id:workspace,execution_scope:'production',mode:'scheduled',input_commit:null,versions:{implementation_commit:null,projects:[]},policy_check_refs:[],started_at:now,finished_at:now,outcome:'success_no_selection',source_results:[f.good],project_ids:[],usage:sumUsage([]),failures:[],delivery_results:[],blocked_projects:[]};
  await f.journal.commit('runs/'+run.run_id,run);const view=await inspectSourceGaps(f.journal),request={...f.verification,expected_revision:view.expected_revision,evidence_refs:[{record_key:'runs/'+run.run_id,sha256:sha256(canonicalJson(run))}]};
  expect(await verifySourceBackfill(f.journal,request)).toMatchObject({can_fill:false,observations:[{covers_gap:true,record_key:'runs/backfill-observed'}]});
  expect((await f.journal.load<SourceHealth>('sources/health'))!.gaps[gapId]!.status).toBe('open');
  await acceptSourceGap(f.journal,{...f.request,expected_revision:view.expected_revision},'owner');
  const cold=await f.cold(),health=(await cold.load<SourceHealth>('sources/health'))!;
  expect(health.gaps[gapId]!.status).toBe('accepted');expect(health.events.at(-1)!.kind).toBe('accepted_gap');expect(health.events.some(event=>event.kind==='gap_resolved')).toBe(false);
  expect(Object.entries(health.gaps).filter(([key])=>key!==gapId).every(([,gap])=>gap.status==='open')).toBe(true);
  expect(await acceptSourceGap(cold,{...f.request,expected_revision:view.expected_revision},'owner')).toMatchObject({status:'already_applied'});
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('backfill verification catches an intervening writer and CLI exposes only existing-workspace diagnostics with explicit evidence input',async()=>{
 const f=await backfillFixture();try{
  const load=f.journal.load.bind(f.journal);let interfere=true;
  f.journal.load=async<T>(key:string)=>{const value=await load<T>(key);if(key==='sources/health'&&interfere){interfere=false;await f.journal.commit('intervening-host-fact',{schema_version:1,fact:'unchanged coverage'});}return value;};
  await expect(verifySourceBackfill(f.journal,f.verification)).rejects.toThrow('revision changed');
  const cold=await f.cold();expect((await cold.load<SourceHealth>('sources/health'))!.gaps[gapId]!.status).toBe('open');
  const args=['verify-source-backfill','--deployment','agents/reading/deploy/examples/integration.json','--mode','scheduled','--request-file','/protected/evidence.json'];
  expect(parseCli(args)).toMatchObject({command:'verify-source-backfill',request_file:'/protected/evidence.json'});
  expect(()=>parseCli(args.slice(0,-2))).toThrow('request_file_required');
  expect(()=>parseCli([...args,'--input-url','https://example.org/new'])).toThrow('maintenance_existing_workspace_only');
 }finally{await rm(f.root,{recursive:true,force:true});}
});


it('real diagnostic CLI restores only the existing preview namespace and reports unsupported history without a checkpoint, query, acceptance or cursor change',async()=>{
 const root=await mkdtemp(join(tmpdir(),'backfill-cli-')),workspace='obs-notes-hub/reading-preview/history-test';try{
  const store=new FileObjectStore(join(root,'object-store')),manager=new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,local_root:join(root,'fixture'),record_validator:validateHostRecords});
  const journal=new WorkspaceJournal(manager,await manager.restore(workspace,{allow_initialize:true}),'history-cli');
  const result:SourceResult={source_id:'claude_resources',status:'success',reason_code:null,attempted_at:now,last_success_at:now,cursor_before:null,cursor_after:null,coverage:{from:'2026-10-01T00:00:00.000Z',to:now},coverage_gap:{from:'2026-10-01T00:00:00.000Z',to:now,reason:'source_no_history_pagination'},unsupported:[]};
  const health=applySourceResult(emptySourceHealth(),result,workspace,'preview',now);
  await journal.commitMany({'sources/health':health,'sources/claude_resources/result':result,'sources/claude_resources/progress':emptySourceProgress()},'source_incidents_reconciled');
  const view=await inspectSourceGaps(journal),gap=view.gaps[0]!,request={schema_version:1,action:'verify_backfill',verification_id:'diagnostic-cli',workspace_id:workspace,execution_scope:'preview',source_id:'claude_resources',gap_id:gap.gap_id,expected_revision:view.expected_revision,expected_gap_hash:gap.expected_gap_hash,evidence_refs:[{record_key:'sources/claude_resources/result',sha256:sha256(canonicalJson(result))}]};
  const path=join(root,'request.json');await writeFile(path,JSON.stringify(request));const revision=journal.handle.revision,before=canonicalJson(journal.handle.records);
  const output=await promisify(execFile)('npx',['tsx','agents/reading/src/cli.ts','verify-source-backfill','--deployment','agents/reading/deploy/examples/preview.json','--mode','preview','--preview-id','history-test','--local','--local-root',root,'--request-file',path]);
  expect(JSON.parse(output.stdout)).toMatchObject({status:'unverified',can_fill:false,revision,history_contract:null});
  const restored=await manager.restore(workspace);expect(restored.revision).toBe(revision);expect(canonicalJson(restored.records)).toBe(before);expect(Object.keys(restored.records).some(key=>key.startsWith('invocations/')||key.startsWith('source-gap-management/'))).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
},60_000);

it('legacy version-one filled facts and gap_resolved events survive cold restore without being rewritten or re-certified by unsupported backfill diagnostics',async()=>{
 const f=await backfillFixture();try{
  // Explicit old-release fixture, not a newly verified-fill operation.
  const legacy=structuredClone((await f.journal.load<SourceHealth>('sources/health'))!);
  legacy.gaps[gapId]!.status='filled';const position=legacy.events.at(-1)!.position+1;
  legacy.events.push({event_id:'source_event_'+position,position,workspace_id:workspace,execution_scope:'production',source_id:'claude_resources',reason_code:'coverage_gap',kind:'gap_resolved',occurred_at:now,gap_id:gapId});
  await f.journal.commit('sources/health',legacy);const revision=f.journal.handle.revision,commitHash=f.journal.handle.snapshot.commit_sha256;
  const cold=await f.cold();expect(cold.handle.revision).toBe(revision);expect(cold.handle.snapshot.commit_sha256).toBe(commitHash);expect(await cold.load('sources/health')).toEqual(legacy);
  const view=await inspectSourceGaps(cold),gap=view.gaps.find(gap=>gap.gap_id===gapId)!;
  await expect(verifySourceBackfill(cold,{...f.verification,expected_revision:revision,expected_gap_hash:gap.expected_gap_hash})).rejects.toThrow('gap drift');
  expect(cold.handle.revision).toBe(revision);expect(await cold.load('sources/health')).toEqual(legacy);expect(cold.keys('source-gap-management/')).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

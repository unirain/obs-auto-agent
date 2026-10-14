import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {acceptSourceGap,inspectSourceGaps,type AcceptSourceGapRequest} from '../../src/app/source-gap-management.js';
import {emptySourceHealth,applySourceResult,type SourceHealth} from '../../src/collect/incidents.js';
import {emptySourceProgress,type SourceResult} from '../../src/collect/sources.js';
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

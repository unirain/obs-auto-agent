import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {AgentError,sha256,type WorkspaceHandle,type CheckpointResult} from '../../src/contracts/index.js';
import {collectGarbage} from '../../src/workspace/gc.js';
import {listAll} from '../../src/storage/preflight.js';
const id='obs-notes-hub/reading';
const committed=(result:CheckpointResult)=>{if(result.status!=='committed')throw new Error(result.status);return result.handle;};
it('two independent filesystem clients race identical prepared commit bytes and both read back the same intent; different stale intent cannot jump sequence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'same-intent-'));try{
  const otherStore=new FileObjectStore(join(root,'objects')),receipts:{client:number;hash:string;outcome:string}[]=[];
  class RacingStore extends FileObjectStore{
   raced=false;
   override async create(key:string,bytes:Uint8Array){
    if(!this.raced&&key.endsWith('/commits/00000000000000000001.json')){
     this.raced=true;const writers=[(k:string,b:Uint8Array)=>super.create(k,b),(k:string,b:Uint8Array)=>otherStore.create(k,b)];
     const results=await Promise.allSettled(writers.map(write=>write(key,bytes)));
     for(let client=0;client<results.length;client++){const result=results[client]!;if(result.status==='rejected'){expect(result.reason).toBeInstanceOf(AgentError);expect(result.reason.code).toBe('conflict');}const reader=client===0?this:otherStore;const actual=await reader.read(key);expect(sha256(actual)).toBe(sha256(bytes));receipts.push({client,hash:sha256(actual),outcome:result.status==='fulfilled'?'created':'conflict_then_matched'});}
     throw new AgentError('unknown','initiating response lost after identical intent race');
    }return super.create(key,bytes);
   }
  }
  const store=new RacingStore(join(root,'objects')),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:join(root,'a')}),initial=await manager.restore(id,{allow_initialize:true});
  const other=new ImmutableWorkspaceManager({store:otherStore,scope:'production',verify_preflight:false,local_root:join(root,'b')}),stale=await other.restore(id);
  const winner=committed(await manager.checkpoint(initial,{expected_revision:initial.revision,reason:'same_prepared_intent',run_id:'r',records:{fact:{same:true}}}));
  expect(receipts).toHaveLength(2);expect(new Set(receipts.map(receipt=>receipt.hash)).size).toBe(1);expect(receipts.map(receipt=>receipt.outcome).sort()).toEqual(['conflict_then_matched','created']);
  expect((await other.restore(id)).revision).toBe(winner.revision);
  for(let attempt=0;attempt<2;attempt++)expect((await other.checkpoint(stale,{expected_revision:stale.revision,reason:'different_stale_intent',run_id:'loser',records:{fact:{same:false}}})).status).toBe('conflict');
  const commits=await listAll(store,manager.prefix(id)+'commits/');expect(commits).toHaveLength(2);expect(commits.at(-1)!.key).toBe(winner.snapshot.commit_key);
  const cold=new ImmutableWorkspaceManager({store:new FileObjectStore(join(root,'objects')),scope:'production',verify_preflight:false,local_root:join(root,'cold')});expect((await cold.restore(id)).records.fact).toEqual({same:true});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('GC preserves every immutable commit byte and protected historical chunks, then a fresh manager reconstructs HEAD and complete protected bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gc-cold-chain-'));try{
  const store=new FileObjectStore(join(root,'objects'),1),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:join(root,'before')}),prefix=manager.prefix(id);let head=await manager.restore(id,{allow_initialize:true});
  const body=Buffer.alloc(33*1024*1024,7);body[body.length-1]=31;
  head=committed(await manager.checkpoint(head,{expected_revision:head.revision,reason:'protected_body',run_id:'r1',records:{source:{hash:sha256(body)}},files:[{path:'projects/p/sources/body.bin',bytes:body,role:'evidence',project_id:'p'}]}));const protectedRevision=head.revision;
  head=committed(await manager.checkpoint(head,{expected_revision:head.revision,reason:'detach_historical',run_id:'r2',remove_paths:['projects/p/sources/body.bin'],records:{source:{status:'detached'}}}));
  const commits=async()=>Promise.all((await listAll(store,prefix+'commits/')).map(async object=>({key:object.key,hash:sha256(await store.read(object.key))})));
  const before=await commits(),orphan=prefix+'blobs/'+sha256('old orphan');await store.create(orphan,Buffer.from('old orphan'));
  const result=await collectGarbage(store,prefix,head,{protected_revisions:new Set([protectedRevision]),reference_knowledge_complete:true,now:'2027-10-14T00:00:00Z'});expect(result.deleted).toContain(orphan);expect(await commits()).toEqual(before);
  await rm(join(root,'before'),{recursive:true,force:true});const cold=new ImmutableWorkspaceManager({store:new FileObjectStore(join(root,'objects'),1),scope:'production',verify_preflight:false,local_root:join(root,'cold')}),restored=await cold.restore(id);
  expect(restored.revision).toBe(head.revision);expect(restored.snapshot.sequence).toBe(head.snapshot.sequence);expect(restored.records.source).toEqual({status:'detached'});
  const historical=await cold.restoreRevision(id,protectedRevision),bytes=await cold.readFile(historical,'projects/p/sources/body.bin');expect(bytes.length).toBe(body.length);expect(sha256(bytes)).toBe(sha256(body));expect(bytes[bytes.length-1]).toBe(31);expect(historical.snapshot.manifest.files.find(file=>file.path.endsWith('body.bin'))!.chunks).toHaveLength(2);
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

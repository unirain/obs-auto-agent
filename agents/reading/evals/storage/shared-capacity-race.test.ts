import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {AgentError,type WorkspaceHandle,type CheckpointResult} from '../../src/contracts/index.js';
import {managedInventory} from '../../src/storage/inventory.js';
import {capacityView,type StorageReservation} from '../../src/storage/capacity.js';
import {reserve,releaseUnwrittenReservation} from '../../src/storage/reservations.js';
const committed=(result:CheckpointResult)=>{if(result.status!=='committed')throw new Error(result.status);return result.handle;};
it.each(['production','preview'] as const)('%s and the other scope compete under one capacity mutex; cold state and safe release never cross-write ledgers',async winner=>{
 const root=await mkdtemp(join(tmpdir(),'shared-capacity-race-'));try{
  const sessions=await Promise.all((['production','preview'] as const).map(async scope=>{const store=new FileObjectStore(join(root,'objects'),2),id=scope==='production'?'obs-notes-hub/reading':'obs-notes-hub/reading-preview/capacity',manager=new ImmutableWorkspaceManager({store,scope,verify_preflight:false,local_root:join(root,scope)});let handle=await manager.restore(id,{allow_initialize:true});return {scope,id,manager,store,get handle(){return handle;},set handle(value:WorkspaceHandle){handle=value;}};}));
  let tail:Promise<void>=Promise.resolve();const mutex=<T>(work:()=>Promise<T>)=>{const task=tail.then(work);tail=task.then(()=>{},()=>{});return task;};
  const view=async()=>capacityView(await managedInventory(sessions.map(session=>({store:session.store,prefix:session.manager.prefix(session.id)})),[{inventory:async()=>({complete:true,objects:[{bucket:'readonly-managed-images',key:'history/image-v1',version:'v1',size:48_998_500_000,created_at:'2026-10-01T00:00:00Z'}]})}]),sessions.flatMap(session=>Object.entries(session.handle.records).filter(([key])=>key.startsWith('storage/reservations/')).map(([,value])=>value as unknown as StorageReservation)));
  const request=(scope:'production'|'preview'):StorageReservation=>({schema_version:1,reservation_id:scope+'-r',execution_scope:scope,bucket:sessions[0]!.store.bucket,key:'pending/'+scope+'.bin',version:null,expected_bytes:1_000_000,state:'pending'});
  const take=(scope:'production'|'preview')=>mutex(async()=>{const session=sessions.find(value=>value.scope===scope)!;session.handle=committed(await reserve(session.manager,session.handle,request(scope),await view(),'reserve-'+scope));});
  const loser=winner==='production'?'preview':'production';const results=await Promise.allSettled([take(winner),take(loser)]);expect(results[0]!.status).toBe('fulfilled');expect(results[1]!.status).toBe('rejected');if(results[1]!.status==='rejected')expect(results[1]!.reason).toMatchObject({code:'capacity'});
  const first=sessions.find(value=>value.scope===winner)!,second=sessions.find(value=>value.scope===loser)!;expect(first.handle.records['storage/reservations/'+winner+'-r']).toMatchObject({execution_scope:winner,state:'pending'});expect(Object.keys(second.handle.records)).toEqual([]);expect((await view()).reserved_bytes).toBe(1_000_000);
  await expect(first.manager.checkpoint(second.handle,{expected_revision:second.handle.revision,reason:'cross_scope',run_id:'invalid',records:{invalid:true}})).rejects.toMatchObject({code:'scope'});
  for(const session of sessions){await rm(join(root,session.scope),{recursive:true,force:true});const fresh=new ImmutableWorkspaceManager({store:new FileObjectStore(join(root,'objects'),2),scope:session.scope,verify_preflight:false,local_root:join(root,'cold-'+session.scope)});const restored=await fresh.restore(session.id);expect(restored.records).toEqual(session.handle.records);}
  await mutex(async()=>{const released=await releaseUnwrittenReservation(first.store,request(winner));first.handle=committed(await first.manager.checkpoint(first.handle,{expected_revision:first.handle.revision,reason:'storage_reconciled',run_id:'release',records:{['storage/reservations/'+winner+'-r']:released as never}}));});
  expect((await view()).reserved_bytes).toBe(0);await take(loser);expect((await view()).reserved_bytes).toBe(1_000_000);expect(first.handle.records['storage/reservations/'+loser+'-r']).toBeUndefined();expect(second.handle.records['storage/reservations/'+winner+'-r']).toBeUndefined();expect(first.handle.records['storage/reservations/'+winner+'-r']).toMatchObject({state:'released'});
 }finally{await rm(root,{recursive:true,force:true});}
});

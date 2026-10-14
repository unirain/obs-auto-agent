import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {sha256} from '../../src/contracts/index.js';
import {listAll} from '../../src/storage/preflight.js';
it.each(['commit','manifest'] as const)('%s read timeout, permission denial or corruption cannot initialize and leave the prior chain intact for the next client',async boundary=>{
 const root=await mkdtemp(join(tmpdir(),'restore-read-failures-'));try{
  const objects=join(root,'objects'),store=new FileObjectStore(objects,1),manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:join(root,'initial')}),id='obs-notes-hub/reading';const initial=await manager.restore(id,{allow_initialize:true});
  const result=await manager.checkpoint(initial,{expected_revision:initial.revision,reason:'known_prior_state',run_id:'r',records:{fact:{unchanged:true}},files:[{path:'projects/p/research/prior.txt',bytes:Buffer.from('verified source bytes'),role:'evidence',project_id:'p'}]});if(result.status!=='committed')throw new Error(result.status);const head=result.handle;
  const key=boundary==='commit'?head.snapshot.commit_key:head.snapshot.manifest_key;
  const chain=await Promise.all((await listAll(store,manager.prefix(id)+'commits/')).map(async object=>({key:object.key,hash:sha256(await store.read(object.key))})));
  for(const kind of ['before','permission','corrupt'] as const){
   const reader=new FileObjectStore(objects,1);reader.faults.push({operation:'read',key,kind});const fresh=new ImmutableWorkspaceManager({store:reader,scope:'production',verify_preflight:false,local_root:join(root,'failure-'+kind)});
   await expect(fresh.restore(id,{allow_initialize:true})).rejects.toMatchObject({code:kind==='before'?'transient':kind==='permission'?'permission':'corrupt'});expect(reader.calls.filter(call=>['create','delete'].includes(call.operation))).toEqual([]);
   const cold=new ImmutableWorkspaceManager({store:new FileObjectStore(objects,1),scope:'production',verify_preflight:false,local_root:join(root,'verified-'+kind)}),restored=await cold.restore(id);expect(restored.revision).toBe(head.revision);expect(restored.records.fact).toEqual({unchanged:true});expect(Buffer.from(await cold.readFile(restored,'projects/p/research/prior.txt')).toString()).toBe('verified source bytes');
   expect(await Promise.all((await listAll(store,manager.prefix(id)+'commits/')).map(async object=>({key:object.key,hash:sha256(await store.read(object.key))})))).toEqual(chain);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {readCapacityCommitChain} from '../../src/storage/broker.js';
import {AgentError} from '../../src/contracts/index.js';
async function fixture(){const root=await mkdtemp(join(tmpdir(),'capacity-window-')),store=new FileObjectStore(join(root,'objects')),manager=new ImmutableWorkspaceManager({store,scope:'preview',local_root:join(root,'view'),verify_preflight:false}),workspace='obs-notes-hub/reading-preview/chain';let handle=await manager.restore(workspace,{allow_initialize:true});for(let i=1;i<=16;i++){const result=await manager.checkpoint(handle,{expected_revision:handle.revision,reason:'fixture',run_id:'fixture',records:{counter:i}});if(result.status!=='committed')throw new Error('fixture');handle=result.handle;}const prefix=manager.prefix(workspace),keys=(await store.list(prefix+'commits/')).objects.map(o=>o.key).sort();return {root,store,manager,workspace,handle,prefix,keys};}
it('bounds live reads to eight, restores sequence order despite completion reordering, and leaves all persistent bytes unchanged',async()=>{
 const f=await fixture();try{let active=0,max=0;const reads:string[]=[];
 const head=await readCapacityCommitChain({read:async key=>{active++;max=Math.max(max,active);reads.push(key);try{await new Promise(resolve=>setTimeout(resolve,(17-Number(key.match(/(\d+)\.json$/)![1]))%4));return await f.store.read(key);}finally{active--;}}},f.prefix,f.keys);
 expect(max).toBe(8);expect(active).toBe(0);expect(reads).toEqual(f.keys);expect(head.revision).toBe(f.handle.revision);
 const cold=new ImmutableWorkspaceManager({store:f.store,scope:'preview',local_root:join(f.root,'cold'),verify_preflight:false});expect((await cold.restore(f.workspace)).records.counter).toBe(16);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('joins every started read in a failed window, emits no capacity result, and the next cold call still validates the entire chain',async()=>{
 const f=await fixture();try{let release!:()=>void,done=false;const barrier=new Promise<void>(resolve=>{release=resolve;}),started:string[]=[],finished:string[]=[],error=new AgentError('unknown','fixture unknown');
 const attempt=readCapacityCommitChain({read:async key=>{started.push(key);try{if(key===f.keys[2])throw error;await barrier;return await f.store.read(key);}finally{finished.push(key);}}},f.prefix,f.keys).catch(value=>{done=true;return value;});
 await new Promise(resolve=>setTimeout(resolve,5));expect(started).toHaveLength(8);expect(done).toBe(false);release();expect(await attempt).toBe(error);expect(finished).toHaveLength(8);expect(started).toHaveLength(8);
 const reads:string[]=[];expect((await readCapacityCommitChain({read:async key=>{reads.push(key);return f.store.read(key);}},f.prefix,f.keys)).revision).toBe(f.handle.revision);expect(reads).toEqual(f.keys);
 const cold=new ImmutableWorkspaceManager({store:f.store,scope:'preview',local_root:join(f.root,'cold-failure'),verify_preflight:false});expect((await cold.restore(f.workspace)).records.counter).toBe(16);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('rejects a listed gap before reads and rereads altered parent bytes rather than trusting a warm result',async()=>{
 const f=await fixture();try{let reads=0;await expect(readCapacityCommitChain({read:async key=>{reads++;return f.store.read(key);}},f.prefix,[f.keys[1]!])).rejects.toThrow('chain gap');expect(reads).toBe(0);
 await readCapacityCommitChain(f.store,f.prefix,f.keys);
 await expect(readCapacityCommitChain({read:async key=>{const bytes=await f.store.read(key);if(key===f.keys[0]){const changed=JSON.parse(Buffer.from(bytes).toString());changed.manifest_sha256='a'.repeat(64);return Buffer.from(JSON.stringify(changed));}return bytes;}},f.prefix,f.keys)).rejects.toThrow('identity mismatch');
 expect((await readCapacityCommitChain(f.store,f.prefix,f.keys)).revision).toBe(f.handle.revision);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentError,type JsonValue} from '../../src/contracts/index.js';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {fixedToolBindingFromRecords,readonlyFixedToolBinding} from '../../src/tools/runtime-cache-binding.js';
const image_id='sha256:'+'a'.repeat(64),manifest_hash='b'.repeat(64);
const row=(state='deferred',image=image_id):JsonValue=>({state,context:{runtime_versions:{tools_image_id:image,tools_manifest_hash:manifest_hash}}});
it('active projects retain one exact runtime while terminal historical projects do not force a substitution',()=>{
 expect(fixedToolBindingFromRecords({'projects/a':row(),'projects/b':row(),'projects/old':row('preview_ready','sha256:'+'c'.repeat(64))})).toEqual({image_id,manifest_hash});
 expect(fixedToolBindingFromRecords({'projects/a':row('preview_ready')})).toBeUndefined();
 expect(()=>fixedToolBindingFromRecords({'projects/a':row(),'projects/b':row('deferred','sha256:'+'c'.repeat(64))})).toThrow('bindings_conflict');
 expect(()=>fixedToolBindingFromRecords({'projects/a':{state:'deferred'}})).toThrow('binding_unavailable');
});
it('a known absent workspace remains empty across cold readonly probes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'runtime-binding-'));try{const store=new FileObjectStore(join(root,'store'),100,{versioning:'never',acl:'private',endpoint:'https://oss-cn-beijing.aliyuncs.com',lifecycle:[],anonymous_readable:false});
 for(let i=0;i<2;i++){const manager=new ImmutableWorkspaceManager({store,scope:'preview',local_root:join(root,'cold'+i)});expect(await readonlyFixedToolBinding(()=>manager.restore('obs-notes-hub/reading-preview/test'))).toBeUndefined();}
 expect(store.calls.filter(call=>call.operation==='create'||call.operation==='delete')).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it.each(['permission','unknown','corrupt','not_found'] as const)('restore %s never turns unavailable referenced state into a fresh cache build',async code=>{
 const error=new AgentError(code,code==='not_found'?'OSS object absent':'fixture');
 await expect(readonlyFixedToolBinding(async()=>{throw error;})).rejects.toBe(error);
});

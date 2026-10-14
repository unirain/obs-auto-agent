import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSecretGuard,secretGuardFromEnvironment} from '../../src/security/secrets.js';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {sha256} from '../../src/contracts/index.js';
import {Publisher} from '../../src/publish/publisher.js';
import {ResourcePublisher,type ImageStore} from '../../src/publish/resources.js';
import {deliveryValidationHash} from '../../src/publish/validate.js';
import {FakeGitHub,MemoryJournal,sealed} from '../delivery/helpers.js';
it('sensitive paths, cookies and browser profiles/cache never enter an explicit checkpoint list; allowed text and records containing known credentials also fail before writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'secret-boundary-')),secret='fixture-'+randomUUID();try{
  const guard=secretGuardFromEnvironment({DEEPSEEK_API_KEY:secret,OSS_TEST_CREDENTIALS:JSON.stringify({accessKeyId:'fixture-access-'+randomUUID(),accessKeySecret:secret})}),store=new FileObjectStore(join(root,'objects')),manager=new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,content_validator:guard,local_root:join(root,'local')}),handle=await manager.restore('obs-notes-hub/reading-preview/secrets',{allow_initialize:true}),before=store.calls.filter(call=>call.operation==='create').length;
  const paths=['projects/p/credentials.json','projects/p/auth.json','projects/p/cookies.sqlite','projects/p/cache/blob','projects/p/Cache/data','projects/p/profile/Preferences','projects/p/browser-profile/Default','projects/p/browser-cache/entry','projects/p/local-storage/session','projects/p/session-storage/item','projects/p/IndexedDB/token','projects/p/.env','projects/p/.git/config','projects/p/scratch/key.txt'];
  for(const path of paths)await expect(manager.checkpoint(handle,{expected_revision:handle.revision,reason:'unsafe_artifact',run_id:'r',files:[{path,bytes:Buffer.from('harmless fixture payload'),role:'artifact',project_id:'p'}]})).rejects.toThrow();
  for(const value of [secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64')])await expect(manager.checkpoint(handle,{expected_revision:handle.revision,reason:'note_contains_secret',run_id:'r',files:[{path:'projects/p/draft/Organize Notes By AI/261014-safe.md',bytes:Buffer.from('Allowed note path '+value),role:'artifact',project_id:'p'}]})).rejects.toThrow('Sensitive content is excluded');
  await expect(manager.checkpoint(handle,{expected_revision:handle.revision,reason:'record_contains_secret',run_id:'r',records:{report:{message:secret}}})).rejects.toThrow('Sensitive content is excluded');
  expect(store.calls.filter(call=>call.operation==='create')).toHaveLength(before);expect((await manager.restore(handle.workspace_id)).snapshot.manifest.files).toEqual([]);expect(JSON.stringify(store.calls)).not.toContain(secret);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('cold legacy secret data is rejected before eager materialization or lazy file exposure, with the original immutable chain preserved',async()=>{
 const root=await mkdtemp(join(tmpdir(),'legacy-secret-')),secret='fixture-'+randomUUID();try{
  const store=new FileObjectStore(join(root,'objects')),unsafe=new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,local_root:join(root,'legacy'),content_validator:()=>{}}),id='obs-notes-hub/reading-preview/legacy';const initial=await unsafe.restore(id,{allow_initialize:true});
  const result=await unsafe.checkpoint(initial,{expected_revision:initial.revision,reason:'explicit_legacy_fixture',run_id:'r',files:[{path:'projects/p/draft/note.md',bytes:Buffer.from(secret),role:'artifact'}]});if(result.status!=='committed')throw new Error(result.status);const revision=result.handle.revision;await rm(join(root,'legacy'),{recursive:true,force:true});
  for(const lazy of [false,true]){const local=join(root,lazy?'lazy':'eager'),manager=new ImmutableWorkspaceManager({store:new FileObjectStore(join(root,'objects')),scope:'preview',verify_preflight:false,lazy_restore:lazy,local_root:local,content_validator:createSecretGuard([secret])});if(lazy){const restored=await manager.restore(id);await expect(manager.readFile(restored,'projects/p/draft/note.md')).rejects.toThrow('Sensitive content is excluded');await expect(access(join(restored.root_dir,'projects/p/draft/note.md'))).rejects.toThrow();}else await expect(manager.restore(id)).rejects.toThrow('Sensitive content is excluded');}
  expect((await unsafe.restore(id)).revision).toBe(revision); // trusted fixture inspection, never an automatic migration
 }finally{await rm(root,{recursive:true,force:true});}
});
it('Publisher and image uploader reject known secret content before journal, permission or remote effects and expose no matched value in errors',async()=>{
 const secret='fixture-'+randomUUID(),guard=createSecretGuard([secret]),git=new FakeGitHub(),journal=new MemoryJournal(),delivery=sealed();const content=Buffer.from('# Safe path\n'+secret);delivery.files[0]={...delivery.files[0]!,content,bytes:content.length,sha256:sha256(content)};delivery.validated_hash=deliveryValidationHash(delivery);
 let checks=0;const publisher=new Publisher(git,journal,async()=>{checks++;},{workspace_id:delivery.workspace_id,committedRevision:async()=>delivery.workspace_revision,verifyCommittedDelivery:async()=>{},classificationCurrent:async()=>true,identity:{name:'Bot',email:'bot@example.com'},content_validator:guard});
 const error=await publisher.publish(delivery).catch(error=>error);expect(error.message).toBe('Sensitive content is excluded');expect(String(error)).not.toContain(secret);expect(git.calls).toEqual([]);expect(journal.data.size).toBe(0);expect(checks).toBe(0);
 let images=0,reserved=0;const store:ImageStore={get:async()=>{images++;return null;},create:async()=>{images++;},accessible:async()=>true,url:key=>'https://example.org/'+key};
 const uploader=new ResourcePublisher(store,journal,{reserve:async()=>{reserved++;},confirm:async()=>{}},async()=>{checks++;},'reading-agent/',()=>new Date(),guard);
 await expect(uploader.upload({project_id:'p1',first_generated_date:'2026-10-14',article_slug:'safe',description:'figure',extension:'png',mime:'image/png',content:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(secret)])})).rejects.toThrow('Sensitive content is excluded');expect(images).toBe(0);expect(reserved).toBe(0);expect(checks).toBe(0);expect(journal.data.size).toBe(0);
});
it('environment nested credentials and private-key syntax are recognized while credential references and ordinary engineering text remain admissible',()=>{
 const secret='fixture-'+randomUUID(),appKey='fixture-app-'+randomUUID(),ossKey='fixture-oss-'+randomUUID(),guard=secretGuardFromEnvironment({TEST_GITHUB_APP:JSON.stringify({private_key:appKey}),READING_CAPACITY_VIEW_CREDENTIALS:JSON.stringify({accessKeySecret:ossKey}),DEEPSEEK_API_KEY:secret});
 for(const content of [secret,appKey,ossKey,JSON.stringify({private_key:appKey}),Buffer.from(secret).toString('base64'),['-----BEGIN PRIVATE KEY-----','fixture bytes','-----END PRIVATE KEY-----'].join('\n')])expect(()=>guard(Buffer.from(content))).toThrow('Sensitive content is excluded');
 expect(()=>guard(Buffer.from('Use credential_ref OSS_TEST_CREDENTIALS. Unknown fees remain unknown.'))).not.toThrow();
});

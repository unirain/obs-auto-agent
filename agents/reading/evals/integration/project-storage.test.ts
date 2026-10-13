import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal} from '../../src/app/journal.js';
import {storeProjectBodies,hydrateProjectBodies} from '../../src/app/project-storage.js';
import {newRuntimeProject} from '../../src/stages/driver.js';
import {discoverCandidate} from '../../src/collect/identity.js';
import {buildContext} from '../../src/context/index.js';
import {canonicalJson,sha256} from '../../src/contracts/index.js';
import type {HostProject} from '../../src/app/controller.js';
import {validateHostRecords} from '../../src/app/records.js';

it('a body above the physical blob limit survives cold restart while its project control row stays small',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-body-'));try{
  const store=new FileObjectStore(join(root,'objects'));
  const options={store,scope:'preview' as const,local_root:join(root,'local'),verify_preflight:false,record_validator:validateHostRecords};
  const manager=new ImmutableWorkspaceManager(options),workspace='obs-notes-hub/reading-preview/body';
  const journal=new WorkspaceJournal(manager,await manager.restore(workspace,{allow_initialize:true}),'run1');
  const context=buildContext({index:[],query:'test',heldout:{urls:new Set(),note_paths:new Set()},preferences_hash:'p',skill_commit:'a'.repeat(40),skill_hash:'s',prompt_hash:'p',model:'replay',evidence_versions:[]});
  const candidate=discoverCandidate('manual_url','https://example.org/article','Article',null,new Date().toISOString());
  const text='x'.repeat(33*1024*1024)+'\nlast line';
  const project:HostProject={...newRuntimeProject(candidate,{project_id:'p1',execution_scope:'preview',workspace_id:workspace,context,now:new Date()}),generation_version:1,resume_stage:null,resume_policy:'automatic',reason:null,last_run_id:null,batch_id:'b1',delivery_id:null,sources_verified_at:null};
  project.snapshots=[{url:candidate.url,text,hash:sha256(text),retrieved_at:new Date().toISOString(),links:[],kind:'web'}];
  const stored=storeProjectBodies(project,new Map());expect(Buffer.byteLength(canonicalJson(stored.project))).toBeLessThan(10000);expect(stored.project.snapshots[0]).toMatchObject({text:'',body_metadata:{line_count:2,page_count:null}});
  await journal.commitMany({'projects/p1':stored.project,['contexts/'+context.context_id]:context},'snapshot_stored',stored.files);
  const restoredManager=new ImmutableWorkspaceManager({...options,local_root:join(root,'cold')}),handle=await restoredManager.restore(workspace);
  const persisted=handle.records['projects/p1'] as unknown as HostProject;
  expect(handle.snapshot.manifest.files.find(file=>file.path===stored.files[0]!.path)?.chunks?.length).toBe(2);
  const hydrated=await hydrateProjectBodies(persisted,path=>restoredManager.readFile(handle,path));expect(hydrated.snapshots[0]!.text).toBe(text);
  expect(storeProjectBodies(persisted,new Map(handle.snapshot.manifest.files.map(file=>[file.path,{sha256:file.sha256,size:file.size}]))).files).toHaveLength(0);
  await expect(hydrateProjectBodies(persisted,async()=>Buffer.from('{}'))).rejects.toThrow('body_file_corrupt');
  expect(()=>storeProjectBodies(persisted,new Map())).toThrow('body_reference_invalid');
  expect(()=>validateHostRecords({...handle.records,'projects/p1':{...handle.records['projects/p1'] as Record<string,never>,execution_scope:'production'}},'preview',workspace)).toThrow('scope_identity_mismatch');
  expect(()=>validateHostRecords({...handle.records,['contexts/'+context.context_id]:null},'preview',workspace)).toThrow('context_record_missing');
  expect(()=>validateHostRecords({...handle.records,'projects/p1':{...handle.records['projects/p1'] as Record<string,never>,untrusted_flag:true}},'preview',workspace)).toThrow('field_unknown');
 }finally{await rm(root,{recursive:true,force:true});}
});

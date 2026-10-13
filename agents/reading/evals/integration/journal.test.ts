import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileObjectStore } from '../../src/storage/filesystem.js';
import { ImmutableWorkspaceManager } from '../../src/workspace/manager.js';
import { WorkspaceJournal } from '../../src/app/journal.js';

describe('shared committed application journal',()=>{
  it('serializes independent module checkpoints and survives destruction of local files',async()=>{
    const root=await mkdtemp(join(tmpdir(),'reading-journal-'));
    try {
      const store=new FileObjectStore(join(root,'objects'));
      const manager=new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,local_root:join(root,'local')});
      const handle=await manager.restore('obs-notes-hub/reading-preview/test',{allow_initialize:true});
      const journal=new WorkspaceJournal(manager,handle,'run1');
      await Promise.all([journal.commit('a',{value:1}),journal.commit('b',{value:2})]);
      await rm(join(root,'local'),{recursive:true,force:true});
      const fresh=await new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,local_root:join(root,'restored')}).restore(handle.workspace_id);
      expect(fresh.records.a).toEqual({value:1});expect(fresh.records.b).toEqual({value:2});
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('stops queued writes after an uncertain checkpoint rather than continuing stale state',async()=>{
    const root=await mkdtemp(join(tmpdir(),'reading-journal-fault-'));
    try {
      const store=new FileObjectStore(join(root,'objects'));
      const manager=new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,local_root:join(root,'local')});
      const handle=await manager.restore('obs-notes-hub/reading-preview/test',{allow_initialize:true});
      const journal=new WorkspaceJournal(manager,handle,'run1');
      store.faults.push({operation:'create',kind:'permission'});
      const results=await Promise.allSettled([journal.commit('a',{v:1}),journal.commit('b',{v:2})]);
      expect(results.every(r=>r.status==='rejected')).toBe(true);
      expect(journal.handle.revision).toBe(handle.revision);
    }finally{await rm(root,{recursive:true,force:true});}
  });
});

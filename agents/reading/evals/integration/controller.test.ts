import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileObjectStore } from '../../src/storage/filesystem.js';
import { ImmutableWorkspaceManager } from '../../src/workspace/manager.js';
import { WorkspaceJournal } from '../../src/app/journal.js';
import { ReadingController,type ControllerPorts,type HostProject } from '../../src/app/controller.js';
import { PolicyGate,type TrustedPolicy } from '../../src/policy/gate.js';
import { RunDeadline } from '../../src/runtime/deadline.js';
import { StageExecutor } from '../../src/stages/executor.js';
import { ApplicationInvocationJournal } from '../../src/app/journal.js';
import { buildContext } from '../../src/context/index.js';
import { UrlGateway } from '../../src/tools/fetch.js';
import type { Scope } from '../../src/stages/contracts.js';
import { parseDispatch } from '../../src/config/dispatch.js';

const policy:TrustedPolicy={commit:'a'.repeat(40),hash:'p',semantic_policy_hash:'s',paused:false,paused_projects:[],sources:{},manual_url:{enabled:true},allowed_domains:['example.org'],denied_domains:[],excluded_topics:[]};
async function fixture(scope:Scope){
  const root=await mkdtemp(join(tmpdir(),'reading-controller-'));
  const store=new FileObjectStore(join(root,'objects'));
  const manager=new ImmutableWorkspaceManager({store,scope,verify_preflight:false,local_root:join(root,'restore')});
  const id=scope==='preview'?'obs-notes-hub/reading-preview/test':'obs-notes-hub/reading';
  const journal=new WorkspaceJournal(manager,await manager.restore(id,{allow_initialize:true}),'run1');
  const gate=new PolicyGate(async()=>policy,check=>journal.commit(`policy-checks/${check.check_id}`,check));
  const deadline=new RunDeadline();
  const executor=new StageExecutor({async *stream(){throw new Error('unexpected_model_call');}},gate,new ApplicationInvocationJournal(journal));
  const seen:string[]=[];
  const ports:ControllerPorts={journal,gate,deadline,sources:[],context:async()=>buildContext({index:[],query:'test',heldout:{urls:new Set(),note_paths:new Set()},preferences_hash:'p',skill_commit:'a'.repeat(40),skill_hash:'s',prompt_hash:'h',model:'fixture',evidence_versions:[]}),
    environment:async(_project,commit)=>({root,model:'fixture',executor,gate,gateway:new UrlGateway(async()=>{}),deadline,skills:null,commit}),
    prepareResources:async p=>p,verifySources:async()=>new Date().toISOString(),seal:async()=>{seen.push('seal');},reconcile:async p=>p,
    publish:async p=>{seen.push('publish');return {...p,state:'pr_open'};},
    execute:async(project,stage)=>{
      seen.push(stage);const files=stage==='writing'?[{path:`projects/${project.project_id}/draft/Organize Notes By AI/test.md`,bytes:Buffer.from('fixture artifact'),role:'artifact' as const,project_id:project.project_id}]:[];
      return {project,decision:'complete',reason:null,files,validated:stage==='review'};
    },
  };
  return {root,store,manager,journal,ports,seen,cleanup:()=>rm(root,{recursive:true,force:true})};
}
describe('host lifecycle and durable mode boundaries',()=>{
  it('runs preview stages, seals private output and never calls Publisher',async()=>{
    const f=await fixture('preview');try{
      const report=await new ReadingController(f.ports).run(parseDispatch({input_urls:['https://example.org/a']}),'user');
      expect(f.seen).toEqual(['selection','research','writing','review']);expect(report.outcome).toBe('success_preview');
      expect(f.journal.handle.snapshot.manifest.files.some(file=>file.path.startsWith('outputs/'))).toBe(true);
      const restored=await f.manager.restore(f.journal.handle.workspace_id);
      expect(restored.records['runs/run1']).toMatchObject({outcome:'success_preview',mode:'preview'});
    }finally{await f.cleanup();}
  });
  it('records batch yield with stage and resumes without losing the candidate',async()=>{
    const f=await fixture('preview');try{
      f.ports.execute=async(project)=>({project,decision:'batch_yield',reason:'batch_yield',files:[],validated:false});
      await new ReadingController(f.ports).run(parseDispatch({input_urls:['https://example.org/a']}),'user');
      const project=(await f.journal.load<{candidates:Record<string,{project_id:string}>}>('identity'))!;
      const id=Object.values(project.candidates)[0]!.project_id;
      expect(await f.journal.load(`projects/${id}`)).toMatchObject({state:'deferred',resume_stage:'selection',resume_policy:'automatic'});
    }finally{await f.cleanup();}
  });
  it('keeps publishing after an uncertain PR result and only reconciles on the next run',async()=>{
    const f=await fixture('production');try{
      f.ports.publish=async()=>{throw new Error('github_result_unknown');};
      await new ReadingController(f.ports).run(parseDispatch({mode:'scheduled',input_urls:['https://example.org/a']}),'user');
      const key=f.journal.keys('projects/')[0]!;const project=(await f.journal.load<HostProject>(key))!;
      expect(project.state).toBe('publishing');
      const nextJournal=new WorkspaceJournal(f.manager,await f.manager.restore(project.workspace_id),'run2');
      const effects:string[]=[];
      const nextPorts={...f.ports,journal:nextJournal,reconcile:async(p:HostProject)=>{effects.push('reconcile');return p;},publish:async(p:HostProject)=>{effects.push('publish');return p;}};
      await new ReadingController(nextPorts).run(parseDispatch({mode:'scheduled'}),'user');
      expect(effects).toEqual(['reconcile']);
    }finally{await f.cleanup();}
  });
  it('publish-only performs no reading or model phases',async()=>{
    const f=await fixture('production');try{
      f.ports.execute=async()=>{throw new Error('must_not_read');};
      await expect(new ReadingController(f.ports).run(parseDispatch({mode:'publish-only',project_id:'missing'}),'user')).rejects.toThrow('existing_project_required');
      expect(f.seen).toEqual([]);
    }finally{await f.cleanup();}
  });
});

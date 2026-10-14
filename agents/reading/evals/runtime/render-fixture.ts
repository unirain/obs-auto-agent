import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {digest} from '../../src/stages/contracts.js';
import {canonicalJson} from '../../src/contracts/index.js';
import {newRuntimeProject,type RuntimeFile} from '../../src/stages/driver.js';
import {createRenderPersistence} from '../../src/stages/render-persistence.js';
import {discoverCandidate} from '../../src/collect/identity.js';
import {buildContext} from '../../src/context/index.js';
import type {SkillBundle} from '../../src/tools/skills.js';
const exec=promisify(execFile),project_id='render_project',workspace='obs-notes-hub/reading-preview/render';
// Fixed fault script, not article code or the real drawing skill. Its only job is to
// exercise the production validate/render/check/export process and persistence boundary.
const script=`import sys,base64
from pathlib import Path
a=sys.argv[1:]
with Path('projects/render_project/commands.log').open('a') as log: log.write(a[0]+'\\n')
if a[0]=='validate': print('valid fixture input')
elif a[0]=='render': Path(a[3]).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>')
elif a[0]=='check':
 assert Path(a[1]).read_text().startswith('<svg')
 print('checked fixture SVG')
elif a[0]=='export-png':
 if Path(a[1]).with_suffix('.fail-export').exists(): sys.exit(42)
 Path(a[2]).write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII='))
else: sys.exit(43)
`;
export async function renderFixture(rootBase=tmpdir()){
 await mkdir(rootBase,{recursive:true});const root=await mkdtemp(join(rootBase,'reading-render-recovery-')),objects=join(root,'objects'),store=new FileObjectStore(objects);
 const createManager=(local:string)=>new ImmutableWorkspaceManager({store,scope:'preview',verify_preflight:false,local_root:join(root,local),record_validator:validateHostRecords});
 const initial=createManager('initial'),journal=new WorkspaceJournal(initial,await initial.restore(workspace,{allow_initialize:true}),'render1');
 await journal.commitMany({},'research_snapshot',[{path:`projects/${project_id}/sources/prior.txt`,role:'evidence',project_id,bytes:Buffer.from('Previously inspected material remains intact.')}]);
 const context=buildContext({index:[],query:'fixture',heldout:{urls:new Set(),note_paths:new Set()},preferences_hash:digest('preferences'),prompt_hash:digest('prompts'),skill_commit:'a'.repeat(40),skill_hash:digest('fixture'),model:'fixture-not-called',evidence_versions:[]});
 const project=newRuntimeProject(discoverCandidate('manual_url','https://example.org/article','Fixture',null,'2026-10-14T00:00:00Z'),{project_id,workspace_id:workspace,execution_scope:'preview',context,now:new Date('2026-10-14T00:00:00Z')});
 const makeRoot=async(name:string)=>{const bundleRoot=join(root,name),relative='.agents/skills/fireworks-tech-graph/scripts/fireworks.py';await mkdir(dirname(join(bundleRoot,relative)),{recursive:true});await writeFile(join(bundleRoot,relative),script);await mkdir(join(bundleRoot,'projects',project_id,'draft/图文件'),{recursive:true});return {root:bundleRoot,commit:'a'.repeat(40),hash:digest(canonicalJson({[relative]:digest(script)})),files:{[relative]:digest(script)},adapted:true} satisfies SkillBundle;};
 const bundle=await makeRoot('tools1'),rendered:Record<string,Uint8Array>={},files:RuntimeFile[]=[];
 const commit=async(_project:unknown,artifacts:RuntimeFile[],reason:string)=>journal.commitMany({},reason,artifacts);
 const persistence=createRenderPersistence(project,rendered,files,commit);
 const input={project_id,mode:'flow',name:'core',diagram:{nodes:[{id:'intent'}]}};
 const fault=join(bundle.root,`projects/${project_id}/draft/图文件/core.fail-export`);await writeFile(fault,'exit 42 after source commit');
 const native=(fixed:SkillBundle)=>({run:async(args:string[],deadline:number)=>{const output=await exec('python3',['-S',join(fixed.root,'.agents/skills/fireworks-tech-graph/scripts/fireworks.py'),...args],{cwd:fixed.root,timeout:Math.max(1,deadline-Date.now()),env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});return output.stdout;}});
 const cold=async()=>{await rm(bundle.root,{recursive:true,force:true});await rm(join(root,'initial'),{recursive:true,force:true});const manager=createManager('cold'),coldJournal=new WorkspaceJournal(manager,await manager.restore(workspace),'render2'),fixed=await makeRoot('tools2'),recovered:Record<string,Uint8Array>={};const prefix=`projects/${project_id}/draft/`;for(const entry of coldJournal.handle.snapshot.manifest.files)if(entry.path.startsWith(prefix))recovered[entry.path.slice(prefix.length)]=await manager.readFile(coldJournal.handle,entry.path);return {journal:coldJournal,manager,bundle:fixed,rendered:recovered,persistence:createRenderPersistence(project,recovered,[],async(_p,artifacts,reason)=>coldJournal.commitMany({},reason,artifacts))};};
 return {root,store,journal,bundle,input,persistence,rendered,files,native,cold,cleanup:()=>rm(root,{recursive:true,force:true}),commands:async(fixed:SkillBundle)=>(await readFile(join(fixed.root,'projects',project_id,'commands.log'),'utf8')).trim().split('\n')};
}

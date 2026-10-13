import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,chmod,readFile} from 'node:fs/promises';
import path from 'node:path';
import {digest} from '../stages/contracts.js';
import {canonicalJson} from '../contracts/index.js';
import {safeRelative,toolEnvironment} from './files.js';
import {SandboxRunner,type SandboxMount} from './sandbox.js';
const exec=promisify(execFile);
const skills=['obsidian-note','fireworks-tech-graph'] as const;
export type SkillBundle={commit:string;hash:string;files:Record<string,string>;root:string;adapted:boolean};
export async function materializeSkills(repository:string,commit:string,root:string):Promise<SkillBundle>{
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('skill_commit_not_fixed');
  const listing=await exec('git',['-C',repository,'ls-tree','-rz','--full-tree',commit,'--',...skills.map(skill=>`.agents/skills/${skill}`)],{maxBuffer:20_000_000});
  const entries=listing.stdout.split('\0').filter(Boolean);if(!entries.length)throw new Error('skill_bundle_missing');const files:Record<string,string>={};let adapted=false;
  for(const entry of entries){const match=/^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);if(!match||!['100644','100755'].includes(match[1]!))throw new Error('skill_symlink_or_type_denied');const relative=safeRelative(match[3]!);
    const result=await exec('git',['-C',repository,'show',`${commit}:${relative}`],{encoding:'buffer',maxBuffer:20_000_000});const bytes=result.stdout as Buffer;files[relative]=digest(bytes);
    if(relative.endsWith('obsidian-note/SKILL.md'))adapted=bytes.toString().includes('VAULT_ROOT');
    for(const view of ['.agents/skills','.claude/skills']){const dest=path.join(root,relative.replace('.agents/skills',view));await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes,{mode:0o444});await chmod(dest,0o444);}
  }
  for(const skill of skills)if(!files[`.agents/skills/${skill}/SKILL.md`])throw new Error('skill_entry_missing');
  // Lock directories after every trusted file has been materialized. Restored OSS artifacts never supply these files.
  const dirs=new Set<string>();for(const relative of Object.keys(files))for(const view of ['.agents/skills','.claude/skills']){let directory=path.dirname(path.join(root,relative.replace('.agents/skills',view)));while(directory!==root){dirs.add(directory);directory=path.dirname(directory);}}
  for(const directory of [...dirs].sort((a,b)=>b.length-a.length))await chmod(directory,0o555);
  return {commit,hash:digest(canonicalJson(files)),files,root,adapted};
}
export async function readSkill(bundle:SkillBundle,skill:string,resource='SKILL.md'):Promise<string>{
  if(!skills.includes(skill as typeof skills[number]))throw new Error('skill_not_allowed');const relative=safeRelative(`.agents/skills/${skill}/${resource}`);const expected=bundle.files[relative];if(!expected)throw new Error('skill_resource_not_trusted');
  const bytes=await readFile(path.join(bundle.root,relative));if(digest(bytes)!==expected)throw new Error('skill_changed');return bytes.toString();
}
export async function runFireworks(bundle:SkillBundle,args:string[],deadline:number):Promise<string>{
  const allowed=new Set(['doctor','version','validate','render','check','export-png']);if(!args[0]||!allowed.has(args[0]))throw new Error('skill_command_denied');
  const script='.agents/skills/fireworks-tech-graph/scripts/fireworks.py';const bytes=await readFile(path.join(bundle.root,script));if(digest(bytes)!==bundle.files[script])throw new Error('skill_script_untrusted');
  const remaining=deadline-Date.now();if(remaining<=0)throw new Error('run_deadline');
  const mounts:SandboxMount[]=[{source:path.join(bundle.root,'.agents/skills'),target:'/workspace/.agents/skills',readonly:true}];
  const projects=new Set(args.flatMap(arg=>{const match=/^projects\/([a-zA-Z0-9_-]+)\//.exec(arg);return match?[match[1]!]:[];}));
  if(projects.size>1)throw new Error('tool_cross_project_mount');for(const project of projects)mounts.push({source:path.join(bundle.root,'projects',project),target:`/workspace/projects/${project}`,readonly:false});
  for(const arg of args)if(arg.includes('..')||arg.startsWith('/')||arg.includes('\\'))throw new Error('tool_argument_path_denied');
  return new SandboxRunner().run('python3',['-S',`/workspace/${script}`,...args],mounts,deadline);
}
export const cloudSkillMapping={vault:'VAULT_ROOT',browser:'mcp__reading__read_main / mcp__reading__follow_reference',image:'mcp__reading__read_image',render:'mcp__reading__render_diagram',upload:'controller ResourceManifest; preview relative paths',install:'build-time only'} as const;

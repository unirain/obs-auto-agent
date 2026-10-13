import {execFile,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
export type SandboxMount={source:string;target:string;readonly:boolean};
/** Tools are always isolated. No silent host fallback is permitted when Docker/image setup is missing. */
export class SandboxRunner {
  private immutableImage:string|null=null;
  constructor(private readonly image=process.env.READING_TOOLS_IMAGE??''){}
  private async arguments(program:string,args:string[],mounts:SandboxMount[],name:string):Promise<string[]>{
    if(!this.image)throw new Error('tool_sandbox_unconfigured');if(!this.immutableImage){const result=await exec('docker',['image','inspect','--format','{{.Id}}',this.image],{timeout:30_000});const id=result.stdout.trim();if(!/^sha256:[a-f0-9]{64}$/.test(id))throw new Error('tool_image_not_immutable');this.immutableImage=id;}
    const mounted:string[]=[];for(const mount of mounts){if(!mount.target.startsWith('/workspace/')||mount.source.includes(',')||mount.target.includes(','))throw new Error('tool_mount_invalid');const source=await realpath(mount.source);mounted.push('--mount',`type=bind,src=${source},dst=${mount.target}${mount.readonly?',readonly':''}`);}
    return ['run','--rm','--name',name,'-i','--network','none','--read-only','--memory','1g','--pids-limit','256','--cpus','2','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,size=256m',
      '--user',`${process.getuid?.()??10001}:${process.getgid?.()??10001}`,'--workdir','/workspace','--env','LANG=C.UTF-8','--env','HOME=/tmp/tool-home','--env','VAULT_ROOT=/workspace','--env','PYTHONDONTWRITEBYTECODE=1','--env','PYTHONNOUSERSITE=1',
      ...mounted,'--entrypoint',program,this.immutableImage,...args];
  }
  async run(program:string,args:string[],mounts:SandboxMount[],deadline:number):Promise<string>{
    if(!['python3','pdfinfo','pdftotext','node'].includes(program))throw new Error('tool_program_denied');const name=`reading-tool-${randomUUID()}`;const command=await this.arguments(program,args,mounts,name);const timeout=deadline-Date.now();if(timeout<=0)throw new Error('run_deadline');
    try{const result=await exec('docker',command,{timeout,maxBuffer:4_000_000});return result.stdout;}finally{await exec('docker',['rm','-f',name],{timeout:10_000}).catch(()=>{});}
  }
  async spawn(program:'node',args:string[],deadline:number):Promise<{child:ChildProcessWithoutNullStreams;close:()=>Promise<void>}>{const name=`reading-tool-${randomUUID()}`;const command=await this.arguments(program,args,[],name);if(deadline<=Date.now())throw new Error('run_deadline');
    const child=spawn('docker',command,{stdio:['pipe','pipe','pipe']});const timer=setTimeout(()=>{void exec('docker',['rm','-f',name],{timeout:10_000}).catch(()=>{});},deadline-Date.now());timer.unref();
    return {child,close:async()=>{clearTimeout(timer);child.stdin.end();await exec('docker',['rm','-f',name],{timeout:10_000}).catch(()=>{});}};
  }
}

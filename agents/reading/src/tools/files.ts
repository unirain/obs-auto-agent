import {lstat,realpath,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
export function safeRelative(value:string):string {
  if(!value||path.posix.isAbsolute(value)||value.includes('\\')||value.includes('\0')||value.split('/').some(part=>part==='..'||part==='.'||part==='')||/^[A-Za-z]:/.test(value))throw new Error('unsafe_file_path');return value;
}
export class ScopedFiles {
  constructor(private readonly root:string,private readonly readable:string[],private readonly writable:string[]){}
  private async resolve(relative:string,write:boolean):Promise<string> {
    safeRelative(relative);const allowed=write?this.writable:this.readable;
    if(!allowed.some(prefix=>relative===prefix||relative.startsWith(`${prefix}/`)))throw new Error('file_capability_denied');
    const trustedRoot=await realpath(this.root);const parts=relative.split('/');let current=trustedRoot;
    for(let index=0;index<parts.length;index++){current=path.join(current,parts[index]!);try{const entry=await lstat(current);if(entry.isSymbolicLink())throw new Error('file_symlink_denied');if(index<parts.length-1&&!entry.isDirectory())throw new Error('file_parent_not_directory');}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&write){if(index<parts.length-1)await mkdir(current);continue;}throw error;}}
    if(!current.startsWith(`${trustedRoot}${path.sep}`))throw new Error('file_escape');return current;
  }
  async read(relative:string,max_bytes=2_000_000):Promise<Uint8Array>{const file=await this.resolve(relative,false);const stats=await lstat(file);if(!stats.isFile()||stats.size>max_bytes)throw new Error('file_read_size_or_type');return readFile(file);}
  async write(relative:string,bytes:Uint8Array,max_bytes=10_000_000):Promise<void>{if(bytes.length>max_bytes)throw new Error('file_write_size');const file=await this.resolve(relative,true);await writeFile(file,bytes,{flag:'w'});}
}
export function toolEnvironment(root:string):Record<string,string>{return {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:path.join(root,'scratch/tool-home'),LANG:'C.UTF-8',VAULT_ROOT:root,PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1'};}

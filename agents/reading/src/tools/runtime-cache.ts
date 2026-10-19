import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,open,readdir,readFile,realpath,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Octokit} from '@octokit/rest';
import {inspectToolsRuntime,type ToolRuntimeBinding} from './sandbox.js';

const exec=promisify(execFile);
const HASH=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const NAME=/^reading-tools-v1-([a-f0-9]{64})-([a-f0-9]{64})$/;
const WORKFLOW='.github/workflows/reading-agent.yml';
const MAX_ARCHIVE_BYTES=6_000_000_000;
export type ToolBuildIdentity={build_fingerprint:string;browser_worker_hash:string;package_lock_hash:string};
export type ToolCacheManifest=ToolBuildIdentity&{schema_version:1;image_id:string;manifest_hash:string;archive_sha256:string;archive_bytes:number};
export type ToolCacheArtifact={id:number;name:string;expired:boolean;archive_sha256:string;repository:string;head_repository:string;branch:string;workflow_path:string;event:string};
export interface ToolCacheArtifactPort {
  /** An incomplete or failed list is never cache absence. */
  list():Promise<{complete:boolean;artifacts:ToolCacheArtifact[]}>;
  /** Writes only manifest.json and image.tar into the supplied empty directory. */
  download(artifact:ToolCacheArtifact,directory:string):Promise<void>;
}
export interface ToolCacheDockerPort {
  inspect(image:string):Promise<ToolRuntimeBinding&{manifest:Record<string,string>}>;
  save(image_id:string,archive:string):Promise<void>;
  load(archive:string):Promise<string[]>;
}
export type ToolCacheRestoreResult={status:'cache_miss';build_fingerprint:string}|{status:'restored';image_id:string;manifest_hash:string;artifact_id:number;artifact_name:string;build_fingerprint:string};

function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('tool_cache_manifest_invalid');return value as Record<string,unknown>;}
export function parseToolCacheManifest(value:unknown):ToolCacheManifest{
  const row=record(value),keys=['schema_version','build_fingerprint','browser_worker_hash','package_lock_hash','image_id','manifest_hash','archive_sha256','archive_bytes'];
  if(Object.keys(row).length!==keys.length||Object.keys(row).some(key=>!keys.includes(key))||row.schema_version!==1||typeof row.image_id!=='string'||!IMAGE.test(row.image_id)||['build_fingerprint','browser_worker_hash','package_lock_hash','manifest_hash','archive_sha256'].some(key=>typeof row[key]!=='string'||!HASH.test(row[key] as string))||!Number.isSafeInteger(row.archive_bytes)||(row.archive_bytes as number)<=0||(row.archive_bytes as number)>MAX_ARCHIVE_BYTES)throw new Error('tool_cache_manifest_invalid');
  return row as ToolCacheManifest;
}
function assertIdentity(identity:ToolBuildIdentity):void{const keys=['build_fingerprint','browser_worker_hash','package_lock_hash'];if(Object.keys(identity).length!==keys.length||keys.some(key=>typeof identity[key as keyof ToolBuildIdentity]!=='string'||!HASH.test(identity[key as keyof ToolBuildIdentity])))throw new Error('tool_cache_build_identity_invalid');}
function assertBinding(binding:ToolRuntimeBinding):void{if(!IMAGE.test(binding.image_id)||!HASH.test(binding.manifest_hash))throw new Error('tool_cache_fixed_binding_invalid');}
function artifactName(identity:ToolBuildIdentity,image_id:string):string{return `reading-tools-v1-${identity.build_fingerprint}-${image_id.slice(7)}`;}

async function regularFile(path:string,maxBytes:number):Promise<number>{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>maxBytes)throw new Error('tool_cache_file_invalid');return info.size;}
async function fileHash(path:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function trustedPath(root:string,relative:string):Promise<string>{let path=root;for(const part of relative.split('/')){path=join(path,part);const info=await lstat(path);if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile()))throw new Error('tool_cache_build_path_invalid');}return path;}
/** Only trusted build inputs, never source/project configuration, participate in this host cache key. */
export async function toolBuildIdentity(root:string):Promise<ToolBuildIdentity>{
  const base=await realpath(root),paths=['package.json','package-lock.json','tsconfig.json','tsconfig.build.json','.dockerignore','agents/reading/tools/Dockerfile','dist/agents/reading/src/tools/browser-worker.js'];
  async function walk(relative:string):Promise<void>{const path=await trustedPath(base,relative);for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink()||(!entry.isDirectory()&&!entry.isFile()))throw new Error('tool_cache_build_path_invalid');const next=relative+'/'+entry.name;if(entry.isDirectory())await walk(next);else paths.push(next);}}
  await walk('agents/reading/src');
  const hash=createHash('sha256');let bytes=0;for(const relative of paths.sort()){const path=await trustedPath(base,relative);bytes+=await regularFile(path,8_000_000);if(bytes>50_000_000)throw new Error('tool_cache_build_inputs_too_large');hash.update(relative+'\0');hash.update(await readFile(path));hash.update('\0');}
  const lock=await trustedPath(base,'package-lock.json'),worker=await trustedPath(base,'dist/agents/reading/src/tools/browser-worker.js');await regularFile(worker,8_000_000);
  return {build_fingerprint:hash.digest('hex'),package_lock_hash:await fileHash(lock),browser_worker_hash:await fileHash(worker)};
}
async function emptyDirectory(path:string):Promise<string>{const absolute=resolve(path);await mkdir(absolute,{recursive:true,mode:0o700});if((await realpath(absolute))!==absolute||(await lstat(absolute)).isSymbolicLink()||(await readdir(absolute)).length)throw new Error('tool_cache_directory_not_empty_or_unsafe');return absolute;}
async function immutableJson(path:string,value:unknown):Promise<void>{const handle=await open(path,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}}
function verifyRuntime(actual:ToolRuntimeBinding&{manifest:Record<string,string>},manifest:ToolCacheManifest):void{
  if(actual.image_id!==manifest.image_id||actual.manifest_hash!==manifest.manifest_hash||actual.manifest.browser_worker_hash!==manifest.browser_worker_hash||actual.manifest.package_lock_hash!==manifest.package_lock_hash)throw new Error('tool_cache_loaded_runtime_mismatch');
}
/** No build fallback exists here. In particular a fixed image never becomes a fresh cache miss. */
export async function restoreToolImageCache(input:{identity:ToolBuildIdentity;repository:string;branch:string;output_dir:string;fixed?:ToolRuntimeBinding},ports:{artifacts:ToolCacheArtifactPort;docker:ToolCacheDockerPort}):Promise<ToolCacheRestoreResult>{
  assertIdentity(input.identity);if(input.fixed)assertBinding(input.fixed);
  let listing:Awaited<ReturnType<ToolCacheArtifactPort['list']>>;try{listing=await ports.artifacts.list();}catch{throw new Error('tool_cache_artifact_listing_failed');}if(!listing.complete)throw new Error('tool_cache_artifact_listing_incomplete');
  const candidates=listing.artifacts.filter(artifact=>{const name=NAME.exec(artifact.name);return name&&!artifact.expired&&artifact.repository===input.repository&&artifact.head_repository===input.repository&&artifact.branch===input.branch&&artifact.workflow_path===WORKFLOW&&artifact.event==='workflow_dispatch'&&(input.fixed?name[2]===input.fixed.image_id.slice(7):name[1]===input.identity.build_fingerprint);}).sort((a,b)=>b.id-a.id);
  const artifact=candidates[0];if(!artifact){if(input.fixed)throw new Error('fixed_tools_image_archive_unavailable');return {status:'cache_miss',build_fingerprint:input.identity.build_fingerprint};}
  if(!Number.isSafeInteger(artifact.id)||artifact.id<=0||!HASH.test(artifact.archive_sha256))throw new Error('tool_cache_artifact_metadata_invalid');
  const directory=await emptyDirectory(input.output_dir);await immutableJson(join(directory,'restore-intent.json'),{schema_version:1,operation:'restore_tool_image',artifact_id:artifact.id,artifact_name:artifact.name,fixed:input.fixed??null});
  // A separate empty directory prevents adapters from replacing the already committed intent.
  const contents=join(directory,'contents');await mkdir(contents,{mode:0o700});try{await ports.artifacts.download(artifact,contents);}catch{throw new Error('tool_cache_artifact_download_failed');}
  if((await realpath(contents))!==contents||!(await lstat(contents)).isDirectory())throw new Error('tool_cache_archive_directory_invalid');const names=(await readdir(contents)).sort();if(JSON.stringify(names)!==JSON.stringify(['image.tar','manifest.json']))throw new Error('tool_cache_archive_files_invalid');
  const manifestPath=join(contents,'manifest.json'),archive=join(contents,'image.tar');await regularFile(manifestPath,16_000);let manifest:ToolCacheManifest;try{manifest=parseToolCacheManifest(JSON.parse(await readFile(manifestPath,'utf8')));}catch{throw new Error('tool_cache_manifest_invalid');}
  if(artifact.name!==artifactName(manifest,manifest.image_id))throw new Error('tool_cache_artifact_name_mismatch');
  if(input.fixed){if(manifest.image_id!==input.fixed.image_id||manifest.manifest_hash!==input.fixed.manifest_hash)throw new Error('tool_cache_fixed_binding_mismatch');}
  else if(['build_fingerprint','browser_worker_hash','package_lock_hash'].some(key=>manifest[key as keyof ToolBuildIdentity]!==input.identity[key as keyof ToolBuildIdentity]))throw new Error('tool_cache_build_binding_mismatch');
  if(await regularFile(archive,MAX_ARCHIVE_BYTES)!==manifest.archive_bytes||await fileHash(archive)!==manifest.archive_sha256)throw new Error('tool_cache_archive_hash_mismatch');
  const loaded=await ports.docker.load(archive);if(loaded.length!==1||loaded[0]!==manifest.image_id)throw new Error('tool_cache_loaded_image_mismatch');verifyRuntime(await ports.docker.inspect(manifest.image_id),manifest);
  await immutableJson(join(directory,'restore-receipt.json'),{schema_version:1,artifact_id:artifact.id,artifact_name:artifact.name,manifest});
  return {status:'restored',image_id:manifest.image_id,manifest_hash:manifest.manifest_hash,artifact_id:artifact.id,artifact_name:artifact.name,build_fingerprint:manifest.build_fingerprint};
}
/** Called only for a trusted local Docker build. The caller uploads exactly the returned two files. */
export async function prepareToolImageCache(input:{identity:ToolBuildIdentity;image:string;output_dir:string},docker:ToolCacheDockerPort):Promise<{status:'prepared';artifact_name:string;archive_path:string;manifest_path:string;image_id:string;manifest_hash:string}>{
  assertIdentity(input.identity);const actual=await docker.inspect(input.image);assertBinding(actual);if(actual.manifest.browser_worker_hash!==input.identity.browser_worker_hash||actual.manifest.package_lock_hash!==input.identity.package_lock_hash)throw new Error('tool_cache_current_runtime_mismatch');
  const directory=await emptyDirectory(input.output_dir),name=artifactName(input.identity,actual.image_id),archive=join(directory,'image.tar'),manifestPath=join(directory,'manifest.json');
  await immutableJson(join(directory,'prepare-intent.json'),{schema_version:1,operation:'prepare_tool_image_archive',artifact_name:name,...input.identity,image_id:actual.image_id,manifest_hash:actual.manifest_hash});
  await docker.save(actual.image_id,archive);const archive_bytes=await regularFile(archive,MAX_ARCHIVE_BYTES);if(archive_bytes===0)throw new Error('tool_cache_archive_empty');const saved=await open(archive,'r');try{await saved.sync();}finally{await saved.close();}const manifest:ToolCacheManifest={schema_version:1,...input.identity,image_id:actual.image_id,manifest_hash:actual.manifest_hash,archive_sha256:await fileHash(archive),archive_bytes};
  await immutableJson(manifestPath,manifest);return {status:'prepared',artifact_name:name,archive_path:archive,manifest_path:manifestPath,image_id:actual.image_id,manifest_hash:actual.manifest_hash};
}

export const nativeToolCacheDocker:ToolCacheDockerPort={
  inspect:inspectToolsRuntime,
  async save(image_id,archive){await exec('docker',['image','save','--output',archive,image_id],{timeout:1_200_000,maxBuffer:64_000});},
  async load(archive){const result=await exec('docker',['image','load','--input',archive],{timeout:1_200_000,maxBuffer:64_000});const lines=result.stdout.trim().split('\n');if(lines.some(line=>!/^Loaded image ID: sha256:[a-f0-9]{64}$/.test(line)))throw new Error('tool_cache_docker_load_output_invalid');return lines.map(line=>line.slice('Loaded image ID: '.length));}
};

// Zip members are inspected before extraction; never invoke tar/unzip on unvalidated paths.
const EXTRACT_ZIP=String.raw`import zipfile,sys,os,stat
archive,directory=sys.argv[1:]
with zipfile.ZipFile(archive) as z:
 members=z.infolist()
 if len(members)!=2 or sorted(i.filename for i in members)!=['image.tar','manifest.json']: raise Exception('invalid archive members')
 for i in members:
  mode=i.external_attr>>16
  if i.is_dir() or (stat.S_IFMT(mode) not in (0,stat.S_IFREG)) or i.flag_bits&1 or i.file_size<1 or i.file_size>(16000 if i.filename=='manifest.json' else 6000000000): raise Exception('invalid archive member')
 for i in members:
  fd=os.open(os.path.join(directory,i.filename),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'wb') as out,z.open(i) as source:
   total=0
   while True:
    chunk=source.read(1024*1024)
    if not chunk: break
    total+=len(chunk)
    if total>i.file_size: raise Exception('archive expanded beyond declared size')
    out.write(chunk)
   if total!=i.file_size: raise Exception('archive size mismatch')
   out.flush();os.fsync(out.fileno())
`;
export function githubToolCacheArtifacts(repository:string,branch:string,token:string):ToolCacheArtifactPort{
  const match=/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);if(!match||!branch||!token)throw new Error('tool_cache_github_configuration_invalid');const owner=match[1]!,repo=match[2]!,client=new Octokit({auth:token,request:{timeout:60_000}});
  return {
    async list(){const artifacts:ToolCacheArtifact[]=[];for await(const page of client.paginate.iterator(client.actions.listArtifactsForRepo,{owner,repo,per_page:100})){for(const artifact of page.data){if(!NAME.test(artifact.name)||artifact.expired)continue;const runId=artifact.workflow_run?.id;if(!runId)throw new Error('tool_cache_artifact_provenance_unavailable');const {data:run}=await client.actions.getWorkflowRun({owner,repo,run_id:runId});let path=run.path;if(path===`${repository}/${WORKFLOW}@refs/heads/${branch}`||path===`${repository}/${WORKFLOW}@${branch}`)path=WORKFLOW;artifacts.push({id:artifact.id,name:artifact.name,expired:artifact.expired,archive_sha256:artifact.digest?.replace(/^sha256:/,'')??'',repository:run.repository.full_name,head_repository:run.head_repository.full_name,branch:run.head_branch??'',workflow_path:path,event:run.event});}}return {complete:true,artifacts};},
    async download(artifact,directory){const archive=join(dirname(directory),`artifact-${randomUUID()}.zip`);let url=`https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`;let response:Response|undefined;const signal=AbortSignal.timeout(1_200_000);for(let hop=0;hop<4;hop++){response=await fetch(url,{headers:hop===0?{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}:{},redirect:'manual',signal});if(response.status===302||response.status===301||response.status===307||response.status===308){const target=new URL(response.headers.get('location')??'',url);if(target.protocol!=='https:'||target.username||target.password||!(target.hostname.endsWith('.blob.core.windows.net')||target.hostname.endsWith('.githubusercontent.com')||target.hostname==='api.github.com'))throw new Error('tool_cache_artifact_redirect_invalid');await response.body?.cancel();url=target.href;continue;}break;}
      if(!response||response.status!==200||!response.body)throw new Error('tool_cache_artifact_download_failed');const handle=await open(archive,'wx',0o600);const hash=createHash('sha256');let bytes=0;try{for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>MAX_ARCHIVE_BYTES)throw new Error('tool_cache_artifact_too_large');hash.update(chunk);await handle.writeFile(chunk);}await handle.sync();}finally{await handle.close();}if(hash.digest('hex')!==artifact.archive_sha256)throw new Error('tool_cache_artifact_digest_mismatch');await exec('python3',['-c',EXTRACT_ZIP,archive,directory],{timeout:1_200_000,maxBuffer:16_000});await unlink(archive);
    }
  };
}

/** Host CLI prints one secret-free JSON result. Errors are constant and never expose HTTP/SDK details. */
export async function runtimeCacheCli(args:string[],env:NodeJS.ProcessEnv=process.env):Promise<unknown>{
  const command=args[0];if(command!=='restore'&&command!=='prepare')throw new Error('tool_cache_cli_invalid');const allowed=command==='restore'?['root','output-dir','repository','branch','fixed-image','fixed-manifest']:['root','output-dir','image'];const flags=new Map<string,string>();for(let index=1;index<args.length;index+=2){const key=args[index]?.slice(2),value=args[index+1];if(!args[index]?.startsWith('--')||!key||!allowed.includes(key)||!value||flags.has(key))throw new Error('tool_cache_cli_invalid');flags.set(key,value);}const root=flags.get('root'),output_dir=flags.get('output-dir');if(!root||!output_dir)throw new Error('tool_cache_cli_invalid');const identity=await toolBuildIdentity(root);
  if(command==='prepare'){const image=flags.get('image');if(!image)throw new Error('tool_cache_cli_invalid');return prepareToolImageCache({identity,image,output_dir},nativeToolCacheDocker);}
  const repository=flags.get('repository'),branch=flags.get('branch'),image_id=flags.get('fixed-image'),manifest_hash=flags.get('fixed-manifest');if(!repository||!branch||Boolean(image_id)!==Boolean(manifest_hash))throw new Error('tool_cache_cli_invalid');return restoreToolImageCache({identity,repository,branch,output_dir,...(image_id&&manifest_hash?{fixed:{image_id,manifest_hash}}:{})},{artifacts:githubToolCacheArtifacts(repository,branch,env.GITHUB_TOKEN??''),docker:nativeToolCacheDocker});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){runtimeCacheCli(process.argv.slice(2)).then(result=>{process.stdout.write(JSON.stringify(result)+'\n');}).catch(error=>{const message=error instanceof Error&&/^(?:tool_cache_[a-z_]+|fixed_tools_image_archive_unavailable)$/.test(error.message)?error.message:'tool_cache_operation_failed';process.stderr.write(message+'\n');process.exitCode=1;});}

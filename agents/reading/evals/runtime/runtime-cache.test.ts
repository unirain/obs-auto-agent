import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {githubToolCacheArtifacts,parseToolCacheManifest,prepareToolImageCache,restoreToolImageCache,toolBuildIdentity,type ToolBuildIdentity,type ToolCacheArtifact,type ToolCacheArtifactPort,type ToolCacheDockerPort,type ToolCacheManifest} from '../../src/tools/runtime-cache.js';

const exec=promisify(execFile),sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const identity:ToolBuildIdentity={build_fingerprint:'a'.repeat(64),browser_worker_hash:'b'.repeat(64),package_lock_hash:'c'.repeat(64)};
const image_id='sha256:'+'d'.repeat(64),manifest_hash='e'.repeat(64),bytes=Buffer.from('trusted immutable Docker archive fixture');
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function root(){const path=await realpath(await mkdtemp(join(tmpdir(),'reading-cache-')));roots.push(path);return path;}
function fixture(directory:string){
  const manifest:ToolCacheManifest={schema_version:1,...identity,image_id,manifest_hash,archive_sha256:sha(bytes),archive_bytes:bytes.length};
  const artifact:ToolCacheArtifact={id:7,name:`reading-tools-v1-${identity.build_fingerprint}-${image_id.slice(7)}`,expired:false,archive_sha256:'f'.repeat(64),repository:'owner/repo',head_repository:'owner/repo',branch:'master',workflow_path:'.github/workflows/reading-agent.yml',event:'workflow_dispatch'};
  const inspect=vi.fn(async()=>({image_id,manifest_hash,manifest:{browser_worker_hash:manifest.browser_worker_hash,package_lock_hash:manifest.package_lock_hash}}));
  const load=vi.fn(async()=>[image_id]),save=vi.fn(async(_image:string,path:string)=>{await writeFile(path,bytes);});
  const docker:ToolCacheDockerPort={inspect,load,save};
  const list=vi.fn(async()=>({complete:true,artifacts:[artifact]}));
  const download=vi.fn(async(_artifact:ToolCacheArtifact,path:string)=>{await writeFile(join(path,'manifest.json'),JSON.stringify(manifest));await writeFile(join(path,'image.tar'),bytes);});
  const artifacts:ToolCacheArtifactPort={list,download};
  const input={identity:{...identity},repository:'owner/repo',branch:'master',output_dir:join(directory,'restore')};
  return {manifest,artifact,inspect,load,save,docker,list,download,artifacts,input};
}

describe('immutable tools image artifact cache',()=>{
  it('restores matching bytes into a fresh process, validates the loaded image and runtime, then commits receipt',async()=>{
    const directory=await root(),f=fixture(directory);
    const result=await restoreToolImageCache({...f.input,fixed:{image_id,manifest_hash}},{artifacts:f.artifacts,docker:f.docker});
    expect(result).toEqual({status:'restored',image_id,manifest_hash,artifact_id:7,artifact_name:f.artifact.name,build_fingerprint:identity.build_fingerprint});
    expect(f.load).toHaveBeenCalledExactlyOnceWith(join(f.input.output_dir,'contents','image.tar'));expect(f.inspect).toHaveBeenCalledExactlyOnceWith(image_id);expect(f.save).not.toHaveBeenCalled();
    const receipt=JSON.parse(await readFile(join(f.input.output_dir,'restore-receipt.json'),'utf8'));expect(receipt.manifest).toEqual(f.manifest);
    expect(JSON.parse(await readFile(join(f.input.output_dir,'restore-intent.json'),'utf8')).fixed).toEqual({image_id,manifest_hash});
    // A distinct cold directory consults the immutable artifact again, never a local tag or rebuild.
    const cold=fixture(directory);await restoreToolImageCache({...cold.input,output_dir:join(directory,'cold'),fixed:{image_id,manifest_hash}},{artifacts:cold.artifacts,docker:cold.docker});expect(cold.load).toHaveBeenCalledTimes(1);expect(cold.save).not.toHaveBeenCalled();
  });
  it('old fixed context requires its exact image and manifest while allowing an older worker and build key',async()=>{
    const f=fixture(await root());f.input.identity={build_fingerprint:'1'.repeat(64),browser_worker_hash:'2'.repeat(64),package_lock_hash:'3'.repeat(64)};
    await expect(restoreToolImageCache({...f.input,fixed:{image_id,manifest_hash}},{artifacts:f.artifacts,docker:f.docker})).resolves.toMatchObject({status:'restored',image_id});expect(f.inspect).toHaveBeenCalledWith(image_id);
  });
  it('fresh absence is a cache miss; fixed absence is a hard barrier with no directory, build or Docker activity',async()=>{
    const directory=await root(),f=fixture(directory);f.list.mockResolvedValue({complete:true,artifacts:[]});
    await expect(restoreToolImageCache(f.input,{artifacts:f.artifacts,docker:f.docker})).resolves.toEqual({status:'cache_miss',build_fingerprint:identity.build_fingerprint});
    await expect(restoreToolImageCache({...f.input,fixed:{image_id,manifest_hash}},{artifacts:f.artifacts,docker:f.docker})).rejects.toThrow('fixed_tools_image_archive_unavailable');
    expect(await readdir(directory)).toEqual([]);expect(f.download).not.toHaveBeenCalled();expect(f.load).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();expect(f.inspect).not.toHaveBeenCalled();
  });
  it.each(['failed','incomplete'] as const)('never interprets a %s listing as absence',async mode=>{
    const directory=await root(),f=fixture(directory);if(mode==='failed')f.list.mockRejectedValue(new Error('private transport detail'));else f.list.mockResolvedValue({complete:false,artifacts:[]});
    await expect(restoreToolImageCache(f.input,{artifacts:f.artifacts,docker:f.docker})).rejects.toThrow(mode==='failed'?'tool_cache_artifact_listing_failed':'tool_cache_artifact_listing_incomplete');expect(await readdir(directory)).toEqual([]);expect(f.load).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();
  });
  it.each(['expired','fork','branch','workflow','event','different_image'] as const)('does not restore a fixed image from an untrusted or unavailable %s artifact',async kind=>{
    const f=fixture(await root());if(kind==='expired')f.artifact.expired=true;if(kind==='fork')f.artifact.head_repository='attacker/repo';if(kind==='branch')f.artifact.branch='untrusted';if(kind==='workflow')f.artifact.workflow_path='.github/workflows/arbitrary.yml';if(kind==='event')f.artifact.event='pull_request';if(kind==='different_image')f.artifact.name=f.artifact.name.replace(/d{64}$/,'1'.repeat(64));
    await expect(restoreToolImageCache({...f.input,fixed:{image_id,manifest_hash}},{artifacts:f.artifacts,docker:f.docker})).rejects.toThrow('fixed_tools_image_archive_unavailable');expect(f.download).not.toHaveBeenCalled();expect(f.load).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();
  });
  it.each(['bytes','size','fixed_manifest','worker','lock','name','versionless','version2','extra_key','symlink','extra_file'] as const)('rejects %s before Docker load or tool execution',async kind=>{
    const directory=await root(),f=fixture(directory);if(kind==='size')f.manifest.archive_bytes++;if(kind==='fixed_manifest')f.manifest.manifest_hash='0'.repeat(64);if(kind==='worker')f.manifest.browser_worker_hash='0'.repeat(64);if(kind==='lock')f.manifest.package_lock_hash='0'.repeat(64);if(kind==='name')f.manifest.build_fingerprint='0'.repeat(64);
    f.download.mockImplementation(async(_artifact,path)=>{const value:Record<string,unknown>={...f.manifest};if(kind==='versionless')delete value.schema_version;if(kind==='version2')value.schema_version=2;if(kind==='extra_key')value.arbitrary='executable';await writeFile(join(path,'manifest.json'),JSON.stringify(value));if(kind==='symlink'){await writeFile(join(directory,'outside'),bytes);await symlink(join(directory,'outside'),join(path,'image.tar'));}else await writeFile(join(path,'image.tar'),kind==='bytes'?Buffer.from('other bytes'):bytes);if(kind==='extra_file')await writeFile(join(path,'run.sh'),'untrusted');});
    await expect(restoreToolImageCache({...f.input,...(kind==='fixed_manifest'?{fixed:{image_id,manifest_hash}}:{})},{artifacts:f.artifacts,docker:f.docker})).rejects.toThrow();expect(f.load).not.toHaveBeenCalled();expect(f.inspect).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();expect(await readdir(f.input.output_dir)).not.toContain('restore-receipt.json');
  });
  it.each(['image','manifest','worker'] as const)('refuses a mismatched actual loaded %s without publishing a success receipt',async kind=>{
    const f=fixture(await root());if(kind==='image')f.load.mockResolvedValue(['sha256:'+'0'.repeat(64)]);else if(kind==='manifest')f.inspect.mockResolvedValue({image_id,manifest_hash:'0'.repeat(64),manifest:{browser_worker_hash:identity.browser_worker_hash,package_lock_hash:identity.package_lock_hash}});else f.inspect.mockResolvedValue({image_id,manifest_hash,manifest:{browser_worker_hash:'0'.repeat(64),package_lock_hash:identity.package_lock_hash}});
    await expect(restoreToolImageCache(f.input,{artifacts:f.artifacts,docker:f.docker})).rejects.toThrow(kind==='image'?'tool_cache_loaded_image_mismatch':'tool_cache_loaded_runtime_mismatch');expect(await readdir(f.input.output_dir)).not.toContain('restore-receipt.json');if(kind==='image')expect(f.inspect).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();
  });
  it('commits an immutable local prepare intent before Docker save and emits exactly two upload files',async()=>{
    const directory=await root(),f=fixture(directory),output_dir=join(directory,'prepare');f.save.mockImplementation(async(id,path)=>{const intent=JSON.parse(await readFile(join(output_dir,'prepare-intent.json'),'utf8'));expect(intent).toMatchObject({schema_version:1,operation:'prepare_tool_image_archive',image_id:id,build_fingerprint:identity.build_fingerprint});await writeFile(path,bytes);});
    const prepared=await prepareToolImageCache({identity,image:'reading-tools:local',output_dir},f.docker);expect(prepared).toEqual({status:'prepared',artifact_name:f.artifact.name,archive_path:join(output_dir,'image.tar'),manifest_path:join(output_dir,'manifest.json'),image_id,manifest_hash});expect(parseToolCacheManifest(JSON.parse(await readFile(prepared.manifest_path,'utf8')))).toEqual(f.manifest);
    await expect(prepareToolImageCache({identity,image:'reading-tools:local',output_dir},f.docker)).rejects.toThrow('tool_cache_directory_not_empty_or_unsafe');expect(f.save).toHaveBeenCalledTimes(1);expect(f.load).not.toHaveBeenCalled();
  });
  it('does not archive an image built with another lock or worker',async()=>{
    const directory=await root(),f=fixture(directory);await expect(prepareToolImageCache({identity:{...identity,package_lock_hash:'0'.repeat(64)},image:'reading-tools:local',output_dir:join(directory,'prepare')},f.docker)).rejects.toThrow('tool_cache_current_runtime_mismatch');expect(await readdir(directory)).toEqual([]);expect(f.save).not.toHaveBeenCalled();
  });
  it('fingerprints trusted source bytes and actual compiled worker, and refuses symlink build inputs',async()=>{
    const directory=await root();for(const path of ['agents/reading/tools','agents/reading/src/tools','dist/agents/reading/src/tools'])await mkdir(join(directory,path),{recursive:true});for(const path of ['package.json','package-lock.json','tsconfig.json','tsconfig.build.json','.dockerignore','agents/reading/tools/Dockerfile','agents/reading/src/tools/browser-worker.ts','dist/agents/reading/src/tools/browser-worker.js'])await writeFile(join(directory,path),'trusted '+path);
    const first=await toolBuildIdentity(directory);expect(first.browser_worker_hash).toBe(sha('trusted dist/agents/reading/src/tools/browser-worker.js'));expect(first.package_lock_hash).toBe(sha('trusted package-lock.json'));expect(await toolBuildIdentity(directory)).toEqual(first);await writeFile(join(directory,'dist/agents/reading/src/tools/browser-worker.js'),'changed compiled worker');const changedWorker=await toolBuildIdentity(directory);expect(changedWorker.build_fingerprint).not.toBe(first.build_fingerprint);expect(changedWorker.browser_worker_hash).toBe(sha('changed compiled worker'));await writeFile(join(directory,'agents/reading/src/tools/browser-worker.ts'),'changed');expect((await toolBuildIdentity(directory)).build_fingerprint).not.toBe(first.build_fingerprint);await symlink(join(directory,'package.json'),join(directory,'agents/reading/src/linked.ts'));await expect(toolBuildIdentity(directory)).rejects.toThrow('tool_cache_build_path_invalid');
  });
});

describe('native GitHub artifact download boundary (local ZIP and mocked HTTP only)',()=>{
  async function zip(directory:string,mode:string):Promise<Buffer>{const path=join(directory,'fixture.zip');await exec('python3',['-c',`import zipfile,sys,stat
path,mode=sys.argv[1:]
with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
 z.writestr('manifest.json','{}')
 if mode=='symlink':
  i=zipfile.ZipInfo('image.tar');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'../outside')
 elif mode=='traversal': z.writestr('../outside','bad')
 else: z.writestr('image.tar','trusted tar bytes')
`,path,mode]);return readFile(path);}
  it('streams and verifies GitHub artifact digest, then extracts only fixed regular filenames',async()=>{
    const directory=await root(),f=fixture(directory),archive=await zip(directory,'valid'),contents=join(directory,'contents');await mkdir(contents);f.artifact.archive_sha256=sha(archive);const http=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://example.blob.core.windows.net/artifact'}})).mockResolvedValueOnce(new Response(new Uint8Array(archive)));vi.stubGlobal('fetch',http);await githubToolCacheArtifacts('owner/repo','master','private-host-token').download(f.artifact,contents);expect((await readdir(contents)).sort()).toEqual(['image.tar','manifest.json']);expect(await readFile(join(contents,'image.tar'),'utf8')).toBe('trusted tar bytes');expect(http.mock.calls[1]![1].headers).toEqual({});expect(await readdir(directory)).not.toContain(expect.stringMatching(/^artifact-/));
  });
  it.each(['digest','symlink','traversal','redirect'] as const)('rejects %s without extracting files or forwarding the token',async mode=>{
    const directory=await root(),f=fixture(directory),archive=await zip(directory,mode),contents=join(directory,'contents');await mkdir(contents);f.artifact.archive_sha256=mode==='digest'?'0'.repeat(64):sha(archive);const http=vi.fn().mockResolvedValue(mode==='redirect'?new Response(null,{status:302,headers:{location:'https://attacker.example/archive'}}):new Response(new Uint8Array(archive)));vi.stubGlobal('fetch',http);await expect(githubToolCacheArtifacts('owner/repo','master','private-host-token').download(f.artifact,contents)).rejects.toThrow();expect(await readdir(contents)).toEqual([]);expect(await readdir(directory)).not.toContain('outside');expect(http).toHaveBeenCalledTimes(1);
  });
});

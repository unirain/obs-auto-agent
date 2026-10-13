import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {canonicalJson} from '../contracts/index.js';
import {digest} from '../stages/contracts.js';
export type RuntimeVersions={sdk_version:string;sdk_hash:string;tools_image_id:string;tools_manifest_hash:string;node_version:string;model_version_status:'requested_alias'|'provider_reported_unpinned'};
async function fileHash(path:string):Promise<string>{const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
/** Matches installed SDK's native resolver (glibc/musl ordered fallback), not an imagined cli.js. */
export async function readInstalledSdkVersion():Promise<Pick<RuntimeVersions,'sdk_version'|'sdk_hash'|'node_version'>>{
  const require=createRequire(import.meta.url),entry=require.resolve('@anthropic-ai/claude-agent-sdk');const packageBytes=await readFile(new URL('package.json',pathToFileURL(entry)));const meta=JSON.parse(packageBytes.toString()) as {version?:unknown};if(typeof meta.version!=='string')throw new Error('installed_sdk_version_unavailable');
  const base=`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;const header=(process.report?.getReport() as {header?:{glibcVersionRuntime?:string}}|undefined)?.header;const candidates=process.platform==='linux'?(header?.glibcVersionRuntime?[base,base+'-musl']:[base+'-musl',base]):[base];let native:string|null=null;for(const candidate of candidates){try{native=require.resolve(candidate+'/claude'+(process.platform==='win32'?'.exe':''));break;}catch{}}
  if(!native)throw new Error('installed_sdk_native_unavailable');const [sdk_hash,native_hash]=await Promise.all([fileHash(entry),fileHash(native)]);return {sdk_version:meta.version,sdk_hash:digest(canonicalJson({package_hash:digest(packageBytes),sdk_hash,native_hash})),node_version:process.version};
}
export function verifyRuntimeVersions(fixed:RuntimeVersions|undefined,actual:Omit<RuntimeVersions,'model_version_status'>):void{if(!fixed)throw new Error('fixed_runtime_version_unavailable');for(const key of ['sdk_version','sdk_hash','tools_image_id','tools_manifest_hash','node_version'] as const)if(fixed[key]!==actual[key])throw new Error(`fixed_runtime_version_unavailable:${key}`);}

import {readFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {AgentError,type JsonValue,type WorkspaceHandle} from '../contracts/index.js';
import {parseDeployment,executionTarget} from '../config/deployment.js';
import {parseDispatch} from '../config/dispatch.js';
import {OssObjectStore} from '../storage/oss.js';
import {ImmutableWorkspaceManager} from '../workspace/manager.js';
import {validateHostRecords} from '../app/records.js';
import {secretGuardFromEnvironment} from '../security/secrets.js';
import type {ToolRuntimeBinding} from './sandbox.js';

const terminal=new Set(['merged','closed_unmerged','skipped','preview_ready']);
/** Records must have passed the host validator during immutable-chain restore. */
export function fixedToolBindingFromRecords(records:Record<string,JsonValue>):ToolRuntimeBinding|undefined{
 let fixed:ToolRuntimeBinding|undefined;
 for(const [key,raw] of Object.entries(records)){
  if(!key.startsWith('projects/'))continue;
  const project=raw as Record<string,JsonValue>;
  if(terminal.has(String(project.state)))continue;
  const context=project.context as Record<string,JsonValue>|undefined;
  const versions=context?.runtime_versions as Record<string,JsonValue>|undefined;
  const image_id=versions?.tools_image_id,manifest_hash=versions?.tools_manifest_hash;
  if(typeof image_id!=='string'||!/^sha256:[a-f0-9]{64}$/.test(image_id)||typeof manifest_hash!=='string'||!/^[a-f0-9]{64}$/.test(manifest_hash))throw new Error('fixed_tools_runtime_binding_unavailable');
  if(fixed&&(fixed.image_id!==image_id||fixed.manifest_hash!==manifest_hash))throw new Error('fixed_tools_runtime_bindings_conflict');
  fixed={image_id,manifest_hash};
 }
 return fixed;
}
export async function readonlyFixedToolBinding(restore:()=>Promise<WorkspaceHandle>):Promise<ToolRuntimeBinding|undefined>{
 try{return fixedToolBindingFromRecords((await restore()).records);}
 catch(error){
  // This exact manager error follows a complete empty commit listing AND a
  // NoSuchKey zero-commit probe. Missing referenced objects are different errors.
  if(error instanceof AgentError&&error.code==='not_found'&&error.message==='Workspace not initialized')return undefined;
  throw error;
 }
}
export async function previewToolBindingCli(deploymentPath:string,env:NodeJS.ProcessEnv=process.env):Promise<{status:'fresh'|'fixed';fixed?:ToolRuntimeBinding}>{
 const deployment=parseDeployment(JSON.parse(await readFile(deploymentPath,'utf8')));
 const dispatch=parseDispatch({mode:env.READING_MODE,input_urls:env.READING_INPUT_URLS_JSON,project_id:env.READING_PROJECT_ID,preview_id:env.READING_PREVIEW_ID,submission_id:env.READING_SUBMISSION_ID});
 const target=executionTarget(deployment,dispatch);
 if(deployment.name!=='preview'||dispatch.mode!=='preview')throw new Error('tool_cache_binding_preview_only');
 // Without an explicit preview identity, the application creates a fresh UUID.
 if(!dispatch.preview_id)return {status:'fresh'};
 let credentials:{accessKeyId:string;accessKeySecret:string;stsToken?:string};
 try{credentials=JSON.parse(env[deployment.workspace.credential_ref]??'');if(!credentials.accessKeyId||!credentials.accessKeySecret)throw new Error();}catch{throw new Error('tool_cache_binding_credentials_invalid');}
 const guard=secretGuardFromEnvironment(env,Object.values(credentials));
 const store=new OssObjectStore({...deployment.workspace,...credentials,allowed_prefix:deployment.workspace.prefix});
 const local_root=await mkdtemp(join(env.RUNNER_TEMP??tmpdir(),'reading-binding-'));
 const manager=new ImmutableWorkspaceManager({store,scope:'preview',prefix:deployment.workspace.prefix.replace(/\/$/,''),local_root,lazy_restore:true,record_validator:validateHostRecords,content_validator:guard});
 const fixed=await readonlyFixedToolBinding(()=>manager.restore(target.workspace_id));
 return fixed?{status:'fixed',fixed}:{status:'fresh'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const path=process.argv[2];if(!path)throw new Error('tool_cache_binding_cli_invalid');
 previewToolBindingCli(path).then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(()=>{process.stderr.write('tool_cache_binding_restore_failed\n');process.exitCode=1;});
}

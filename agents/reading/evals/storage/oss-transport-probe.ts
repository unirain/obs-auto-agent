import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {AgentError,sha256,type ObjectStore} from '../../src/contracts/index.js';
import {loadOssCredentials} from '../../src/config/credentials.js';
import {OssObjectStore} from '../../src/storage/oss.js';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {preflight,listAll} from '../../src/storage/preflight.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {TransportLossAgent} from './transport-loss-agent.js';

/** Existing isolated resources only. No model, IAM mutation, bucket creation or commit deletion. */
export async function runOssTransportProbe(env:NodeJS.ProcessEnv=process.env){
 if(env.OSS_LIVE_TEST_ALLOWED!=='isolated-existing-bucket'||!env.OSS_TEST_BUCKET)throw new AgentError('configuration','Explicit existing isolated OSS opt-in required');
 if(env.DEBUG||env.NODE_DEBUG)throw new AgentError('configuration','Transport probe requires diagnostic logging disabled');
 const bucket=env.OSS_TEST_BUCKET,region=env.OSS_TEST_REGION??'oss-cn-beijing',endpoint=env.OSS_TEST_ENDPOINT??'https://oss-cn-beijing.aliyuncs.com';
 const require=createRequire(import.meta.url),sdkRoot=createRequire(require.resolve('ali-oss/package.json'));
 const sdkVersion=JSON.parse(await readFile(require.resolve('ali-oss/package.json'),'utf8')).version as string;const urllibVersion=JSON.parse(await readFile(sdkRoot.resolve('urllib/package.json'),'utf8')).version as string;
 if(sdkVersion!=='6.23.0'||!process.versions.node.startsWith('24.'))throw new AgentError('configuration','Transport probe fixed SDK/Node version unavailable');
 const code_bindings={adapter_sha256:sha256(await readFile(new URL('../../src/storage/oss.ts',import.meta.url))),agent_sha256:sha256(await readFile(new URL('./transport-loss-agent.ts',import.meta.url))),probe_sha256:sha256(await readFile(new URL('./oss-transport-probe.ts',import.meta.url))),sdk_client_sha256:sha256(await readFile(require.resolve('ali-oss/lib/client.js'))),urllib_sha256:sha256(await readFile(sdkRoot.resolve('urllib'))),node_binary_sha256:sha256(await readFile(process.execPath))};
 const prefix=`reading-agent-tests/${randomUUID()}/`,options={bucket,region,endpoint,...await loadOssCredentials(env),allowed_prefix:prefix};
 const ordinary=new OssObjectStore(options);const config=await ordinary.configuration();await preflight(ordinary);
 const base=resolve('.reading-local/oss-transport');await mkdir(base,{recursive:true,mode:0o700});const localRoot=await mkdtemp(join(base,'probe-'));
 // Durable local intent precedes the first cloud write. This contains no credential values.
 const intentManager=new ImmutableWorkspaceManager({store:new FileObjectStore(join(localRoot,'intent-objects')),scope:'preview',local_root:join(localRoot,'intent-view'),verify_preflight:false});
 const intent=await intentManager.restore('obs-notes-hub/reading-preview/transport-intent',{allow_initialize:true});
 const intentResult=await intentManager.checkpoint(intent,{expected_revision:intent.revision,reason:'transport_probe_intent',run_id:'oss-transport-probe',records:{probe:{schema_version:1,bucket,region,endpoint,prefix,operation:'native_put_response_socket_loss',code_bindings}}});
 if(intentResult.status!=='committed')throw new AgentError('unknown','Transport probe intent uncommitted');
 const agent=new TransportLossAgent(`${bucket}.${new URL(config.endpoint).hostname}`);
 const native=new OssObjectStore(options,{https_agent:agent});let target='',intentHash='',putAttempts=0,readbacks=0;let nativeFailure:string|null=null;
 const observed:ObjectStore={bucket,configuration:()=>native.configuration(),stat:key=>native.stat(key),list:(p,c)=>native.list(p,c),delete:key=>native.delete(key),
  create:async(key,bytes)=>{if(key===target){putAttempts++;intentHash=sha256(bytes);}try{await native.create(key,bytes);}catch(error){if(key===target)nativeFailure=error instanceof AgentError?error.code:'unclassified';throw error;}},
  read:async key=>{const bytes=await native.read(key);if(key===target&&agent.trace.socket_destroyed){readbacks++;if(sha256(bytes)!==intentHash)throw new AgentError('corrupt','Transport readback intent mismatch');}return bytes;}};
 try{
  const manager=new ImmutableWorkspaceManager({store:observed,scope:'preview',local_root:join(localRoot,'before'),prefix:prefix+'workspaces'});
  const id='obs-notes-hub/reading-preview/transport';const initial=await manager.restore(id,{allow_initialize:true,run_id:'oss-transport-probe'});
  const firstHash=sha256(await ordinary.read(initial.snapshot.commit_key));
  target=initial.snapshot.commit_key.replace(/00000000000000000000\.json$/,'00000000000000000001.json');
  if(target===initial.snapshot.commit_key)throw new AgentError('corrupt','Transport initial sequence unexpected');agent.arm('/'+target);
  const artifact=Buffer.from('Isolated transport recovery artifact; no article or credentials.');
  const result=await manager.checkpoint(initial,{expected_revision:initial.revision,reason:'transport_loss_checkpoint',run_id:'oss-transport-probe',records:{probe:{schema_version:1,artifact_hash:sha256(artifact)}},files:[{path:'projects/transport_probe/draft/artifact.txt',bytes:artifact,role:'artifact',project_id:'transport_probe'}]});
  const trace=agent.trace;
  if(result.status!=='committed'||putAttempts!==1||nativeFailure!=='unknown'||readbacks<1||trace.target_put_requests!==1||trace.response_events!==0||trace.remote_status!==200||!trace.request_id_sha256||!trace.tls_authorized||!trace.socket_destroyed||trace.suppressed_bytes<1)throw new AgentError('corrupt','Native transport loss reconciliation unproved');
  if(result.handle.snapshot.commit_key!==target||result.handle.snapshot.sequence!=='00000000000000000001'||sha256(await ordinary.read(target))!==intentHash||sha256(await ordinary.read(initial.snapshot.commit_key))!==firstHash)throw new AgentError('corrupt','Transport immutable chain mismatch');
  const commitPrefix=target.slice(0,target.lastIndexOf('/')+1);const commits=await listAll(ordinary,commitPrefix);
  if(commits.length!==2||commits.some(item=>![initial.snapshot.commit_key,target].includes(item.key)))throw new AgentError('corrupt','Transport sequence skipped or duplicated');
  const fresh=new ImmutableWorkspaceManager({store:ordinary,scope:'preview',local_root:join(localRoot,'cold'),prefix:prefix+'workspaces'});const cold=await fresh.restore(id);
  if(cold.revision!==result.handle.revision||cold.snapshot.commit_sha256!==result.handle.snapshot.commit_sha256||JSON.stringify(cold.records)!==JSON.stringify(result.handle.records)||sha256(await fresh.readFile(cold,'projects/transport_probe/draft/artifact.txt'))!==sha256(artifact))throw new AgentError('corrupt','Transport cold recovery mismatch');
  const report={schema_version:1,observed_at:new Date().toISOString(),sdk:'ali-oss@'+sdkVersion,urllib:urllibVersion,node:process.versions.node,code_bindings,bucket,region,endpoint:config.endpoint,isolated_prefix:prefix,configuration:{private:config.acl==='private'&&!config.anonymous_readable,versioning:config.versioning,lifecycle_safe:!config.lifecycle.some(rule=>rule.expires)},local_intent_revision:intentResult.handle.revision,trace,native_failure:nativeFailure,put_attempts:putAttempts,manager_readbacks:readbacks,commit_sha256:intentHash,sequence:cold.snapshot.sequence,immutable_commit_count:commits.length,cold_recovery:'passed',ram_isolation:'live_unverified_separate_identities_required',gate_g1:'incomplete'};
  await writeFile(join(localRoot,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  if(env.OSS_TRANSPORT_REPORT_PATH)await writeFile(env.OSS_TRANSPORT_REPORT_PATH,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  return report;
 }catch(error){await writeFile(join(localRoot,'failure.json'),JSON.stringify({category:error instanceof AgentError?error.code:'unclassified',reason:error instanceof AgentError?error.message:'unclassified',prefix,target,trace:agent.trace,native_failure:nativeFailure,put_attempts:putAttempts,readbacks},null,2)+'\n',{mode:0o600});throw error;}finally{agent.destroy();}
}
if(process.argv[1]?.endsWith('/oss-transport-probe.ts'))runOssTransportProbe().then(report=>process.stdout.write(JSON.stringify(report,null,2)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({status:'failed',category:error instanceof AgentError?error.code:'configuration'})+'\n');process.exitCode=1;});

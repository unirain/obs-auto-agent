import { readFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDeployment,executionTarget } from './config/deployment.js';
import { parseCli,safeError } from './app/cli-options.js';
import { loadOssCredentials } from './config/credentials.js';
import { createObjectStore } from './storage/oss.js';
import { preflight } from './storage/preflight.js';

async function main():Promise<void>{
  const started_at=Date.now();
  const options=parseCli(process.argv.slice(2),process.env);
  const deployment=parseDeployment(JSON.parse(await readFile(resolve(options.deployment),'utf8')));
  if(options.command==='validate-dispatch'){
    const target=executionTarget(deployment,options.dispatch!);
    console.log(JSON.stringify({valid:true,deployment:deployment.name,mode:target.dispatch.mode,scope:target.execution_scope,workspace_id:target.workspace_id,config_hash:target.config_hash}));return;
  }
  if(options.command==='verify-storage'){
    const credentials=await loadOssCredentials();
    const store=createObjectStore({...credentials,bucket:deployment.workspace.bucket,region:deployment.workspace.region,endpoint:deployment.workspace.endpoint,allowed_prefix:deployment.workspace.prefix});
    await preflight(store);console.log(JSON.stringify({verified:true,bucket:deployment.workspace.bucket,scope:deployment.execution_scope,checks:['private_access','versioning_never_enabled','safe_lifecycle','native_public_https'],ram_isolation:'not_proven'}));return;
  }
  if(options.command==='maintenance'){
    const {buildMaintenanceApplication}=await import('./app/bootstrap.js');
    const app=await buildMaintenanceApplication({deployment,dispatch:options.dispatch!,local:options.local,local_root:resolve(options.local_root),run_id:'maintenance-'+randomUUID()});
    console.log(JSON.stringify(await app.maintenance(),null,2));return;
  }
  if(options.command==='watchdog'){
    const {runWatchdogApplication}=await import('./app/watchdog.js');
    console.log(JSON.stringify(await runWatchdogApplication({deployment})));return;
  }
  if(options.command==='status'){
    const tasks=await readFile(resolve('docs/tasks/implementation.md'),'utf8');
    console.log(tasks);return;
  }
  if(!options.notes_repository)throw new Error('notes_repository_required');
  let dispatch=options.dispatch!;
  if(dispatch.mode==='preview'&&!dispatch.preview_id)dispatch={...dispatch,preview_id:randomUUID()};
  await mkdir(resolve(options.local_root),{recursive:true});
  const {buildApplication}=await import('./app/bootstrap.js');
  const application=await buildApplication({deployment,dispatch,started_at,local:options.local,local_root:resolve(options.local_root),notes_repository:resolve(options.notes_repository),run_id:process.env.GITHUB_RUN_ID?`${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT??'1'}`:`local-${randomUUID()}`});
  const report=await application.controller.run(dispatch,process.env.GITHUB_ACTOR??'local-user');
  console.log(JSON.stringify(report,null,2));
  if(['failed_collection','partial','deferred_work'].includes(report.outcome))process.exitCode=2;
}
await main().catch(error=>{console.error(safeError(error));process.exitCode=1;});

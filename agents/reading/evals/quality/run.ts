import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {canonicalJson,sha256} from '../../src/contracts/index.js';
import {validateSamples,freezeDataset,verifyFrozenDataset,evaluate,type LabeledSample,type EvalVersions} from './evaluation.js';
import {mergeEvaluationExecutions} from './aggregate.js';
import type {EvaluationExecution} from './execute.js';
import {processCancellation} from '../../src/app/signals.js';
import type {SnapshotDocument} from './execute.js';
import {parseDeployment} from '../../src/config/deployment.js';
const {positionals,values}=parseArgs({allowPositionals:true,strict:true,options:{input:{type:'string'},versions:{type:'string'},frozen:{type:'string'},output:{type:'string'},config:{type:'string'},snapshots:{type:'string'},'notes-repository':{type:'string'},'implementation-repository':{type:'string'},session:{type:'string'},split:{type:'string'},sample:{type:'string',multiple:true},'local-root':{type:'string'},execution:{type:'string',multiple:true}}});
const read=async(path:string)=>JSON.parse(await readFile(resolve(path),'utf8'));
const samples=(raw:unknown):LabeledSample[]=>{if(!raw||typeof raw!=='object'||!Array.isArray((raw as {samples?:unknown}).samples))throw new Error('evaluation_samples_document_required');return (raw as {samples:LabeledSample[]}).samples;};
const save=async(value:unknown)=>{if(!values.output)throw new Error('evaluation_output_required');const path=resolve(values.output);await mkdir(dirname(path),{recursive:true});const bytes=canonicalJson(value)+'\n';await writeFile(path,bytes,{flag:'wx',mode:0o600});console.log(JSON.stringify({output:path,sha256:sha256(bytes),status:'saved'}));};
if(positionals[0]==='versions'||positionals[0]==='execute'){
 const {executeEvaluation,readEvaluationVersions}=await import('./execute.js');
 if(!values.config||!values['notes-repository'])throw new Error('evaluation_config_and_notes_required');
 const deployment=parseDeployment(await read(values.config));
 if(positionals[0]==='versions')await save(await readEvaluationVersions(deployment,resolve(values['notes-repository']),values['implementation-repository']?resolve(values['implementation-repository']):process.cwd()));
 else {
  if(!values.frozen||!values.snapshots||!values.session||!['development','holdout'].includes(values.split??''))throw new Error('evaluation_execution_inputs_required');
  if(!values.output)throw new Error('evaluation_output_required');
  try{await lstat(resolve(values.output));throw new Error('evaluation_output_exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const cancellation=processCancellation();
  try{await save(await executeEvaluation({frozen:await read(values.frozen),snapshots:await read(values.snapshots) as SnapshotDocument,deployment,notes_repository:resolve(values['notes-repository']),implementation_repository:values['implementation-repository']?resolve(values['implementation-repository']):process.cwd(),session:values.session,split:values.split as 'development'|'holdout',sample_ids:values.sample,local_root:values['local-root'],abort_signal:cancellation.signal}));}finally{cancellation.close();}
 }
}else if(positionals[0]==='merge'){
 if(!values.frozen||!values.execution?.length)throw new Error('evaluation_merge_inputs_required');
 const frozen=await read(values.frozen) as ReturnType<typeof freezeDataset>;
 await save(mergeEvaluationExecutions(frozen,await Promise.all(values.execution.map(path=>read(path))) as EvaluationExecution[],values.input?samples(await read(values.input)):undefined));
}else{
if(!values.input)throw new Error('evaluation_input_required');const input=samples(await read(values.input));
switch(positionals[0]){
 case 'inspect':{validateSamples(input);const result={schema_version:1,samples:input.length,holdout:input.filter(sample=>sample.split==='holdout').length,unlabeled:input.filter(sample=>sample.human_label===null).length,unversioned_sources:input.filter(sample=>!sample.source_snapshot_hash).length,label_status:input.some(sample=>sample.human_label===null)?'awaiting_human_labels':'labeled',gate:'not_passed'};console.log(JSON.stringify(result));break;}
 case 'freeze':{if(!values.versions)throw new Error('evaluation_versions_required');await save(freezeDataset(input,await read(values.versions) as Omit<EvalVersions,'samples_hash'>));break;}
 case 'report':{if(!values.frozen)throw new Error('frozen_dataset_required');const frozen=await read(values.frozen) as ReturnType<typeof freezeDataset>;verifyFrozenDataset(frozen);const document=await read(values.input) as {executions?:EvaluationExecution[]};const aggregated=document.executions?mergeEvaluationExecutions(frozen,document.executions,input):null;const result=evaluate(aggregated?.samples??input,frozen.versions);await save({schema_version:1,frozen_hash:frozen.frozen_hash,execution_scope:result.execution_scope,evaluation:result,...(aggregated?{layer:aggregated.layer,execution_cases:aggregated.cases}:{}),model_version_status:'identifier_only_unverified',quality_gate:'awaiting_user_confirmation'});break;}
 default:throw new Error('evaluation_command_must_be_inspect_versions_freeze_execute_merge_report');
}
}

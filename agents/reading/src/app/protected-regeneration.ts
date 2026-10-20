import {Type} from '@sinclair/typebox';
import {mkdir,readdir,realpath,open,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {canonicalJson,sha256} from '../contracts/index.js';
import {parseModel} from '../stages/contracts.js';
import {RecoveryRequestSchema,type RecoveryRequest} from './recovery.js';
import type {ToolRuntimeBinding} from '../tools/sandbox.js';

const EnvelopeSchema=Type.Object({schema_version:Type.Literal(1),preview_id:Type.String({pattern:'^[A-Za-z0-9_-]+$',minLength:1,maxLength:200}),actor:Type.String({pattern:'^[A-Za-z0-9_-]+$',minLength:1,maxLength:200}),runtime:Type.Object({image_id:Type.String({pattern:'^sha256:[a-f0-9]{64}$'}),manifest_hash:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false}),request:RecoveryRequestSchema},{additionalProperties:false});
export type ProtectedRegeneration={schema_version:1;preview_id:string;actor:string;runtime:ToolRuntimeBinding;request:Extract<RecoveryRequest,{action:'new_generation'}>};
/** Protected host input only. Source/model/workspace files are never request authority. */
export function validateProtectedRegeneration(text:string,binding:{payload_sha256:string;preview_id:string;actor:string}):ProtectedRegeneration{
 try{
  if(Buffer.byteLength(text)>64_000||!/^[a-f0-9]{64}$/.test(binding.payload_sha256)||!binding.actor||!binding.preview_id)throw new Error();
  const envelope=parseModel<ProtectedRegeneration>(EnvelopeSchema,JSON.parse(text));
  if(sha256(canonicalJson(envelope))!==binding.payload_sha256||envelope.actor!==binding.actor||envelope.preview_id!==binding.preview_id||envelope.request.action!=='new_generation'||envelope.request.refresh_runtime!==true||envelope.request.approved_skill_commit!==undefined)throw new Error();
  return envelope;
 }catch{throw new Error('protected_regeneration_invalid');}
}
/** Validation completes before any local file or external effect. The CLI owns mutex/revision/audit application. */
export async function prepareProtectedRegeneration(text:string,binding:{payload_sha256:string;preview_id:string;actor:string},output_dir:string):Promise<{request_file:string;image_id:string;manifest_hash:string;recovery_id:string}>{
 const envelope=validateProtectedRegeneration(text,binding),directory=resolve(output_dir);
 await mkdir(directory,{recursive:true,mode:0o700});if(await realpath(directory)!==directory||(await lstat(directory)).isSymbolicLink()||(await readdir(directory)).length)throw new Error('protected_regeneration_directory_invalid');
 const request_file=join(directory,'request.json'),file=await open(request_file,'wx',0o600);
 try{await file.writeFile(canonicalJson(envelope.request));await file.sync();}finally{await file.close();}
 const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}
 return {request_file,...envelope.runtime,recovery_id:envelope.request.recovery_id};
}

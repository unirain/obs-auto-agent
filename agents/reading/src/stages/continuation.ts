import {Type} from '@sinclair/typebox';
import {canonicalJson} from '../contracts/index.js';
import {digest,ReviewSchema,type Review} from './contracts.js';
import {WritingSchema} from './writing.js';
import type {Writing} from './validation.js';
import type {RuntimeProject} from './driver.js';
import {parseRenderSourceReceipt,type RenderSourceReceipt} from '../tools/render.js';
const text=Type.String({minLength:1}),hash=Type.String({pattern:'^[a-f0-9]{64}$'}),strict={additionalProperties:false};
export const ReviewStageSchema=Type.Union([ReviewSchema,Type.Object({schema_version:Type.Literal(1),decision:Type.Literal('batch_yield'),reason:text,checkpoint:ReviewSchema},strict)]);
export const StageContinuationSchema=Type.Object({schema_version:Type.Literal(1),stage:Type.Union([Type.Literal('writing'),Type.Literal('review')]),context_id:hash,round:Type.Integer({minimum:0}),input_hash:hash,invocation_id:text,checkpoint:Type.Union([WritingSchema,Type.Null()]),review_checkpoint:Type.Optional(Type.Union([ReviewSchema,Type.Null()]))},strict);
export type StageContinuation={schema_version:1;stage:'writing'|'review';context_id:string;round:number;input_hash:string;invocation_id:string;checkpoint:Writing|null;review_checkpoint?:Review|null};
export type ResumeArtifact={path:string;hash:string;render_source?:{receipt:RenderSourceReceipt;diagram:unknown}};
/** Only manifest-restored bytes become resume inputs; a source receipt is checked again against fixed inputs. */
export function resumeArtifacts(project:RuntimeProject,files:Record<string,Uint8Array>):ResumeArtifact[]{
 const result:ResumeArtifact[]=[];
 for(const [path,bytes]of Object.entries(files).sort(([a],[b])=>a.localeCompare(b))){
  const artifact:ResumeArtifact={path,hash:digest(bytes)};
  if(path.endsWith('.render-check.json')){
   const receipt=parseRenderSourceReceipt(JSON.parse(new TextDecoder().decode(bytes)));
   const input=files[receipt.input_path],source=files[receipt.source_path];
   if(receipt.project_id!==project.project_id||receipt.receipt_path!==path||receipt.skill_commit!==project.context.skill_commit||receipt.skill_hash!==project.context.skill_hash||!input||!source||digest(source)!==receipt.source_hash)throw new Error('render_resume_binding_mismatch');
   const diagram:unknown=JSON.parse(new TextDecoder().decode(input));
   if(digest(canonicalJson({project_id:project.project_id,mode:receipt.mode,name:receipt.name,diagram}))!==receipt.input_hash)throw new Error('render_resume_input_mismatch');
   const runtime=project.context.runtime_versions;
   if(canonicalJson(receipt.tool_runtime)!==canonicalJson(runtime?{image_id:runtime.tools_image_id,manifest_hash:runtime.tools_manifest_hash}:null))throw new Error('render_resume_runtime_mismatch');
   artifact.render_source={receipt,diagram};
  }
  result.push(artifact);
 }
 return result;
}
export function verifyContinuation(project:RuntimeProject,stage:'writing'|'review'):StageContinuation|null{
 const value=project.stage_continuation??null;if(!value)return null;
 if(value.stage!==stage||value.context_id!==project.context.context_id||value.round!==project.counters.revisions)throw new Error('stage_continuation_binding_mismatch');
 if(stage==='writing'&&(project.writing_activity?.round!==value.round||value.review_checkpoint!=null))throw new Error('stage_continuation_binding_mismatch');
 if(stage==='review'&&(!project.review_activity||value.checkpoint!==null))throw new Error('stage_continuation_binding_mismatch');
 return value;
}
/** Repeated tool reads and fresh receipt timestamps are not useful output progress. */
export function stageProgressHash(project:RuntimeProject,files:Record<string,Uint8Array>,stage:'writing'|'review'):string{
 return digest(canonicalJson(stage==='writing'?{artifacts:Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith(`图文件/${project.project_id}/`)&&!name.endsWith('.render-check.json')).map(([name,bytes])=>[name,digest(bytes)])),checkpoint:project.stage_continuation?.stage==='writing'?project.stage_continuation.checkpoint??project.writing:project.writing,visual_passed:project.writing_activity?.visual_passed_hashes??[]}:{manifest:project.review_activity?.resource_manifest_hash??null,visual_read:project.review_activity?.visual_read_hashes??[],issues:project.stage_continuation?.review_checkpoint?.issues??[]}));
}

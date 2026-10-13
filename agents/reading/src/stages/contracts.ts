import { createHash } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import {READING_PROJECT_STATES} from '../contracts/transitions.js';
import {UtcInstantSchema} from '../contracts/utc.js';
import { Ajv } from 'ajv';

export const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export type Scope = 'production' | 'preview';
export type Capability = 'discover' | 'main_read' | 'classify_only' | 'select' | 'research' | 'write' | 'review' | 'upload' | 'publish' | 'reconcile' | 'cleanup';
const text = Type.String({ minLength: 1 });
const hash=Type.String({pattern:'^[a-f0-9]{64}$'});
export const ReadingProjectStateSchema=Type.Union(READING_PROJECT_STATES.map(value=>Type.Literal(value)));
export const CapabilitySchema=Type.Union(['discover','main_read','classify_only','select','research','write','review','upload','publish','reconcile','cleanup'].map(value=>Type.Literal(value)));
const nullableText = Type.Union([text, Type.Null()]);
const strict = { additionalProperties: false };
export const CandidateSchema = Type.Object({
  schema_version: Type.Literal(1), candidate_id: text, source_id: text, source_item_id: text,
  origin_source_ids: Type.Array(text), url: text, canonical_url: nullableText, aliases: Type.Array(text),
  title: nullableText, discovered_at: UtcInstantSchema, published_at: Type.Union([UtcInstantSchema,Type.Null()]), submission_refs: Type.Array(text),
  content_hash: Type.Union([hash,Type.Null()]), status: text, project_id: nullableText, pr_number: Type.Union([Type.Integer({minimum: 1}), Type.Null()]),
}, strict);
export type Candidate = Static<typeof CandidateSchema>;
export const SubmissionSchema = Type.Object({
  schema_version: Type.Literal(1), submission_id: text, execution_scope: Type.Literal('production'),
  submitted_by: text, submitted_at: UtcInstantSchema, input_hash: hash,
  items: Type.Array(Type.Object({ url: text, status: Type.Union([Type.Literal('queued'), Type.Literal('already_known'), Type.Literal('rejected')]),
    candidate_id: nullableText, reason_codes: Type.Array(text), candidate_status: nullableText, project_id: nullableText,
    pr_number: Type.Union([Type.Integer({minimum: 1}), Type.Null()]) }, strict)),
}, strict);
export type ManualSubmission = Static<typeof SubmissionSchema>;
export const ClassificationSchema = Type.Object({ content_eligibility: Type.Union([Type.Literal('allowed'), Type.Literal('excluded'), Type.Literal('unresolved')]),
  content_type: text, topic: text, reason_codes: Type.Array(text), evidence: Type.Array(Type.Object({start_line: Type.Integer({minimum:1}), end_line: Type.Integer({minimum:1}), excerpt: text},strict)) }, strict);
export type Classification = Static<typeof ClassificationSchema>;
const rating = Type.Union([Type.Literal('strong'),Type.Literal('partial'),Type.Literal('absent'),Type.Literal('unknown')]);
export const SelectionSchema = Type.Object({ decision: Type.Union([Type.Literal('research'),Type.Literal('skip'),Type.Literal('defer')]),
  reason_codes: Type.Array(text), reason: text,
  dimension_ratings: Type.Object({relevance:rating,mechanism:rating,evidence:rating,transferability:rating,increment:rating},strict),
  questions:Type.Array(text,{maxItems:5}), related_note_ids:Type.Array(text), evidence_ids:Type.Array(text) }, strict);
export type Selection = Static<typeof SelectionSchema>;
export const EvidenceSchema = Type.Object({ evidence_id:text,source_url:text,retrieved_at:UtcInstantSchema,snapshot_hash:hash,
  locator:Type.Object({start_line:Type.Integer({minimum:1}),end_line:Type.Integer({minimum:1}),page:Type.Optional(Type.Integer({minimum:1})),
    section:Type.Optional(text),commit:Type.Optional(Type.String({pattern:'^[a-f0-9]{40}$'})),file:Type.Optional(text)},strict),
  excerpt:text,claim:text,claim_type:Type.Union([Type.Literal('source_statement'),Type.Literal('code_observation'),Type.Literal('experiment_report'),Type.Literal('agent_inference')]),
  limits:Type.Array(text),based_on:Type.Array(text) },strict);
export type Evidence = Static<typeof EvidenceSchema>;
export const ResearchSchema = Type.Object({ project_id:text,
  questions:Type.Array(Type.Object({id:text,text,priority:Type.Union([Type.Literal('required'),Type.Literal('optional')])},strict),{minItems:3,maxItems:5}),
  answers:Type.Array(Type.Object({question_id:text,answer:nullableText,evidence_ids:Type.Array(text),source_not_provided:Type.Boolean()},strict)),
  evidence:Type.Array(EvidenceSchema),gaps:Type.Array(Type.Object({url:text,reason:text,core:Type.Boolean()},strict)),
  source_versions:Type.Array(Type.Object({url:text,hash:text,main:Type.Boolean(),core:Type.Boolean(),status:Type.Union([Type.Literal('read'),Type.Literal('failed'),Type.Literal('registered')])},strict)),
  mechanism_evidence_ids:Type.Array(text), boundary_evidence_ids:Type.Array(text), knowledge_increment:text,
},strict);
export type ResearchPacket = Static<typeof ResearchSchema>;
export const ResearchStageSchema=Type.Union([ResearchSchema,Type.Object({decision:Type.Union([Type.Literal('batch_yield'),Type.Literal('defer'),Type.Literal('skip')]),reason:text,packet:Type.Optional(ResearchSchema)},strict)]);
export const ReviewSchema = Type.Object({issues:Type.Array(Type.Object({severity:Type.Union([Type.Literal('blocking'),Type.Literal('advisory')]),file:text,
  location:text,evidence_ids:Type.Array(text),problem:text,correction:text},strict)),file_hashes:Type.Record(Type.String(),text),resource_manifest_hash:text},strict);
export type Review = Static<typeof ReviewSchema>;
export const StageSchema = Type.Object({project_id:text,stage:Type.Union([Type.Literal('selection'),Type.Literal('research'),Type.Literal('writing'),Type.Literal('review')]),
  decision:Type.Union([Type.Literal('complete'),Type.Literal('skip'),Type.Literal('defer'),Type.Literal('batch_yield'),Type.Literal('manual')]),
  artifact_refs:Type.Array(Type.Object({path:text,hash:text},strict)),issues:Type.Array(text),resume_hint:nullableText},strict);
export type StageResult = Static<typeof StageSchema>;
export const StageTaskSchema=Type.Object({project_id:Type.String({pattern:'^[A-Za-z0-9_-]+$'}),stage:Type.Union(['selection','research','writing','review'].map(value=>Type.Literal(value))),execution_scope:Type.Union([Type.Literal('production'),Type.Literal('preview')]),context_id:hash,input_hash:hash,checkpoint:text,capability:CapabilitySchema,deadline:Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER}),workspace_id:text,state:ReadingProjectStateSchema},strict);
export type StageTask={project_id:string;stage:StageResult['stage'];execution_scope:Scope;context_id:string;input_hash:string;checkpoint:string;capability:Capability;deadline:number;workspace_id:string;state:string};
export function parseStageTask(raw:unknown):StageTask{const task=parseModel<StageTask>(StageTaskSchema,raw);const capabilities:Record<StageTask['stage'],Capability[]>={selection:['classify_only','select'],research:['research'],writing:['write'],review:['review']};if(!capabilities[task.stage].includes(task.capability))throw new Error('stage_capability_mismatch');const active=['discovered','selected','researching','researched','drafted','reviewing','validated','deferred'];if(!active.includes(task.state))throw new Error('stage_state_not_active');const phaseStates:Record<string,string[]>={select:['discovered','selected','deferred'],research:['selected','researching','deferred'],write:['researched','drafted','deferred'],review:['drafted','reviewing','validated','deferred']};if(task.capability!=='classify_only'&&!phaseStates[task.capability]?.includes(task.state))throw new Error('stage_state_mismatch');return task;}
// Model outputs are deliberately distinct from trusted control records.
const ajv = new Ajv({allErrors:true,strict:true});
export function parseModel<T>(schema: object,value: unknown): T {
  const validate=ajv.compile(schema); if (!validate(value)) throw new Error(`invalid_model_result: ${ajv.errorsText(validate.errors)}`);return value as T;
}
export function validateSelection(value:unknown):Selection {
  const selected=parseModel<Selection>(SelectionSchema,value);
  if(selected.decision==='research' && (!['strong','partial'].includes(selected.dimension_ratings.relevance)||!['strong','partial'].includes(selected.dimension_ratings.increment)||selected.questions.length===0)) throw new Error('research_preconditions');
  return selected;
}
export function shanghaiDate(now:Date):string { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }

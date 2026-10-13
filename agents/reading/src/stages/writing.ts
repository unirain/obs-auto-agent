import {Type,type Static} from '@sinclair/typebox';
import {parseModel} from './contracts.js';
import type {Writing} from './validation.js';
const text=Type.String({minLength:1}),nullable=Type.Union([text,Type.Null()]),strict={additionalProperties:false};
export const WritingSchema=Type.Object({note_path:text,markdown:text,
  claims:Type.Array(Type.Object({id:text,text,line:Type.Integer({minimum:1}),evidence_ids:Type.Array(text,{minItems:1}),claim_type:Type.Union([Type.Literal('source_statement'),Type.Literal('code_observation'),Type.Literal('experiment_report'),Type.Literal('agent_inference')])},strict)),
  figure_plan:Type.Array(Type.Object({section:text,type:text,goal:text,resource_path:nullable,no_figure_reason:nullable},strict)),
  resources:Type.Array(Type.Object({path:text,hash:text,mime:text,source_path:nullable,caption:text,visual_check:Type.Union([Type.Literal('passed'),Type.Literal('failed'),Type.Literal('skipped')]),core:Type.Boolean(),url:nullable},strict)),degradations:Type.Array(text)},strict);
export type WritingOutput=Static<typeof WritingSchema>;
export const parseWriting=(raw:unknown):Writing=>parseModel<Writing>(WritingSchema,raw);

import {canonicalJson,sha256} from '../../src/contracts/index.js';
import {parseRunReport,type RunReport} from '../../src/app/run-records.js';
import {parseDeliveryRecord} from '../../src/publish/contracts.js';
import type {DeliveryRecord} from '../../src/publish/types.js';
import {deliveryMetrics} from '../../src/publish/metrics.js';
import {verifyFrozenDataset,type freezeDataset} from './evaluation.js';

type Frozen=ReturnType<typeof freezeDataset>;
export type ReliabilityInput={schema_version:1;frozen_hash:string;expected_run_ids:string[]|null;run_reports:RunReport[];expected_delivery_ids:string[]|null;deliveries:DeliveryRecord[];observed_lost_candidates:{sample_id:string;evidence_reference:string}[]};
function exact(value:unknown,fields:string[],name:string):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key)))throw new Error('reliability_input_invalid:'+name);
}
function expected(raw:unknown,observed:string[],name:string){
 if(raw!==null&&(!Array.isArray(raw)||raw.some(id=>typeof id!=='string'||!id.trim())||new Set(raw).size!==raw.length))throw new Error('reliability_expected_ids_invalid:'+name);
 const ids=raw as string[]|null;
 if(new Set(observed).size!==observed.length)throw new Error('reliability_duplicate_record:'+name);
 if(ids&&observed.some(id=>!ids.includes(id)))throw new Error('reliability_unexpected_record:'+name);
 const missing=ids?.filter(id=>!observed.includes(id))??null;
 return {expected_ids:ids,observed_ids:observed,missing_ids:missing,complete:!!ids?.length&&missing!.length===0};
}
/** Bounded evidence audit, not an automatic claim of source completeness or global delivery history. */
export function reliabilityReport(frozen:Frozen,raw?:unknown){
 verifyFrozenDataset(frozen);
 const input:ReliabilityInput=raw===undefined?{schema_version:1,frozen_hash:frozen.frozen_hash,expected_run_ids:null,run_reports:[],expected_delivery_ids:null,deliveries:[],observed_lost_candidates:[]}:raw as ReliabilityInput;
 exact(input,['schema_version','frozen_hash','expected_run_ids','run_reports','expected_delivery_ids','deliveries','observed_lost_candidates'],'envelope');
 if(input.schema_version!==1||input.frozen_hash!==frozen.frozen_hash||!Array.isArray(input.run_reports)||!Array.isArray(input.deliveries)||!Array.isArray(input.observed_lost_candidates))throw new Error('reliability_frozen_binding_mismatch');
 const reports=input.run_reports.map(parseRunReport),deliveries=input.deliveries.map(record=>parseDeliveryRecord(record));
 const runs=expected(input.expected_run_ids,reports.map(report=>report.run_id),'runs'),deliveryAudit=expected(input.expected_delivery_ids,deliveries.map(delivery=>delivery.delivery_id),'deliveries');
 const eligible=reports.filter(report=>report.mode==='scheduled'&&report.execution_scope==='production'&&report.source_results.length>0);
 const failures=eligible.flatMap(report=>report.source_results.filter(source=>source.status==='failed').map(source=>({run_id:report.run_id,workspace_id:report.workspace_id,source_id:source.source_id,reason_code:source.reason_code,outcome:report.outcome,reported_empty:report.outcome==='success_no_selection'})));
 const falseEmpty=failures.filter(failure=>failure.reported_empty);
 const collectionComplete=runs.complete&&eligible.length===reports.length;
 const losses=new Set<string>();
 for(const observation of input.observed_lost_candidates){
  exact(observation,['sample_id','evidence_reference'],'lost_candidate');
  if(typeof observation.sample_id!=='string'||!frozen.samples.some(sample=>sample.id===observation.sample_id)||typeof observation.evidence_reference!=='string'||!observation.evidence_reference.trim()||observation.evidence_reference.length>2000||losses.has(observation.sample_id))throw new Error('reliability_loss_evidence_invalid');
  losses.add(observation.sample_id);
 }
 const unconfirmedDeliveries=deliveries.filter(record=>record.pr===null||record.uncertain_action!==null).length;
 const duplicateCount=deliveries.some(record=>record.pr!==null)?deliveryMetrics(deliveries,[],{},new Date(0),7).duplicate_prs:null;
 return {schema_version:1,frozen_hash:frozen.frozen_hash,basis:'explicit_bounded_evidence' as const,
  duplicate_prs:{count:deliveryAudit.complete&&unconfirmedDeliveries===0?duplicateCount:null,known_incidents:duplicateCount,unconfirmed_deliveries:unconfirmedDeliveries,audit:deliveryAudit,evidence:deliveries.map(record=>({delivery_id:record.delivery_id,sha256:sha256(canonicalJson(record))}))},
  lost_candidates:{count:null,status:'unknown' as const,reason:'source_completeness_unverified',known_incidents:losses.size||null,observations:structuredClone(input.observed_lost_candidates)},
  source_failures_reported_empty:{count:collectionComplete?falseEmpty.length:null,known_incidents:eligible.length?falseEmpty.length:null,audited_collection_runs:eligible.length,failed_source_observations:failures.length,audit:runs,reason:collectionComplete?null:'complete_production_collection_reports_required',instances:falseEmpty,evidence:reports.map(report=>({run_id:report.run_id,execution_scope:report.execution_scope,sha256:sha256(canonicalJson(report))}))},
 };
}

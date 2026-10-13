import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export type CaseAudit={id:string;local_status:'covered'|'partial'|'missing';evidence:{file:string;test_name:string;proves:string}[];remaining:{layer:'oss_live'|'ram_live'|'sdk_live'|'github_live'|'image_live'|'source_live'|'human_quality'|'production_smoke'|'local';requirement:string}[]};
const layers=new Set(['oss_live','ram_live','sdk_live','github_live','image_live','source_live','human_quality','production_smoke','local']);
export async function loadCaseAudits(paths:string[],ids:string[]):Promise<CaseAudit[]>{
 const rows=new Map<string,CaseAudit>();const indices=new Set<number>();
 for(const path of paths){const raw=JSON.parse(await readFile(resolve(path),'utf8')) as {schema_version:number;case_indices_range:[number,number];cases:CaseAudit[]};
  if(raw.schema_version!==1||!Array.isArray(raw.case_indices_range)||raw.case_indices_range.length!==2||!raw.case_indices_range.every(Number.isSafeInteger))throw new Error('case_audit_header_invalid');const [from,to]=raw.case_indices_range;if(from<0||to>=ids.length||to<from||!Array.isArray(raw.cases)||raw.cases.length!==to-from+1)throw new Error('case_audit_range_invalid');
  for(let offset=0;offset<raw.cases.length;offset++){const index=from+offset,item=raw.cases[offset]!;if(indices.has(index)||rows.has(item.id)||item.id!==ids[index]||!['covered','partial','missing'].includes(item.local_status)||!Array.isArray(item.evidence)||!Array.isArray(item.remaining))throw new Error('case_audit_identity_invalid');indices.add(index);
   if(item.local_status==='covered'&&item.evidence.length===0)throw new Error('local_coverage_without_evidence');
   for(const evidence of item.evidence){if(!evidence.file.startsWith('agents/reading/evals/')||evidence.file.split('/').includes('..')||!evidence.test_name.trim()||!evidence.proves.trim())throw new Error('case_evidence_pointer_invalid');const source=await readFile(resolve(evidence.file),'utf8');if(!source.includes(evidence.test_name))throw new Error('case_evidence_test_missing:'+item.id+':'+evidence.test_name);}
   for(const need of item.remaining)if(!layers.has(need.layer)||!need.requirement.trim())throw new Error('case_audit_remaining_invalid');
   rows.set(item.id,item);
  }
 }
 if(rows.size!==ids.length)throw new Error('case_audit_cases_missing');return ids.map(id=>rows.get(id)!);
}

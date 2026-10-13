import {loadCaseAudits} from './case-audit.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const spec=await readFile(resolve('docs/specs/reading-agent-spec.md'),'utf8');
const mapping=JSON.parse(await readFile(resolve('agents/reading/evals/coverage.json'),'utf8')) as {
  schema_version:number;spec_sha256:string;local_audit_files?:string[];groups:{id:string;status:string}[];
  cases:{id:string;group:string;scenario:string;expected:string;status:string;evidence:string[]}[];
};
if(mapping.schema_version!==1||mapping.spec_sha256!==createHash('sha256').update(spec).digest('hex'))throw new Error('acceptance_mapping_out_of_date');
const section=spec.split('## 验收场景')[1]?.split('## 实施结构')[0];
if(!section)throw new Error('acceptance_section_missing');
const rows=section.split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| 场景')&&!line.startsWith('| ---'));
if(rows.length!==mapping.cases.length)throw new Error('acceptance_cases_missing');
const seen=new Set<string>();const groups=new Set(mapping.groups.map(g=>g.id));
for(let i=0;i<rows.length;i++) {
  const item=mapping.cases[i]!;const columns=rows[i]!.replace(/^\|\s*|\s*\|$/g,'').split(' | ');
  if(seen.has(item.id)||!groups.has(item.group)||item.scenario!==columns[0]||item.expected!==columns[1])throw new Error(`invalid_case_mapping:${item.id}`);
  seen.add(item.id);
  if(item.status==='complete'&&item.evidence.length===0)throw new Error(`completion_without_evidence:${item.id}`);
  for(const path of item.evidence)await readFile(resolve(path));
}
const localAudits=mapping.local_audit_files?await loadCaseAudits(mapping.local_audit_files,mapping.cases.map(item=>item.id)):[];
for(const audit of localAudits){const item=mapping.cases.find(row=>row.id===audit.id)!;if(item.status==='complete'&&audit.remaining.length)throw new Error('complete_case_has_remaining_requirements:'+audit.id);}
const verified=mapping.cases.filter(c=>c.status==='complete').length;
console.log(JSON.stringify({mapped:mapping.cases.length,complete:verified,pending:mapping.cases.length-verified,groups:mapping.groups.length,local_audit:localAudits.length?{covered:localAudits.filter(item=>item.local_status==='covered').length,partial:localAudits.filter(item=>item.local_status==='partial').length,missing:localAudits.filter(item=>item.local_status==='missing').length}:null},null,2));
if(process.argv.includes('--strict')&&verified!==mapping.cases.length)throw new Error('full_spec_verification_incomplete');

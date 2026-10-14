import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadCaseAudits} from '../case-audit.js';
it('evidence index rejects missing cases, stale test pointers and declaring local coverage without a concrete assertion',async()=>{
 const root=await mkdtemp(join(tmpdir(),'case-evidence-'));try{
  const path=join(root,'audit.json'),base={schema_version:1,case_indices_range:[0,0],cases:[{id:'C001',local_status:'partial',evidence:[{file:'agents/reading/evals/quality/evaluation.test.ts',test_name:'refuses unlabeled or too few holdout, and excludes corresponding note paths',proves:'This tests only label admission and exclusion, not real quality.'}],remaining:[{layer:'human_quality',requirement:'Actual human quality calibration remains required.'}]}]};
  base.cases[0]!.remaining.push({layer:'local',requirement:'The actual domain flow has not run.'});
  await writeFile(path,JSON.stringify(base));expect((await loadCaseAudits([path],['C001']))[0]!.local_status).toBe('partial');
  await expect(loadCaseAudits([path],['C001','C002'])).rejects.toThrow('cases_missing');await expect(loadCaseAudits([path,path],['C001'])).rejects.toThrow('identity_invalid');
  const stale=structuredClone(base);stale.cases[0]!.evidence[0]!.test_name='not a real assertion';await writeFile(path,JSON.stringify(stale));await expect(loadCaseAudits([path],['C001'])).rejects.toThrow('test_missing');
  const fake=structuredClone(base);fake.cases[0]!.local_status='covered';fake.cases[0]!.evidence=[];await writeFile(path,JSON.stringify(fake));await expect(loadCaseAudits([path],['C001'])).rejects.toThrow('without_evidence');
  const conflicting=structuredClone(base);conflicting.cases[0]!.local_status='covered';await writeFile(path,JSON.stringify(conflicting));await expect(loadCaseAudits([path],['C001'])).rejects.toThrow('status_conflicts');
 }finally{await rm(root,{recursive:true,force:true});}
});

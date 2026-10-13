import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../../src/stages/contracts.js';
const exec=promisify(execFile),script='agents/reading/evals/quality/run.ts';
it('CLI inspects real unlabeled readiness, freezes validated fixtures without overwrite and refuses changed holdout facts on report import',async()=>{
 const real=JSON.parse((await exec('npx',['tsx',script,'inspect','--input','agents/reading/evals/quality/candidates.unlabeled.json'])).stdout);expect(real).toMatchObject({samples:30,holdout:10,unlabeled:30,unversioned_sources:30,gate:'not_passed'});
 const root=await mkdtemp(join(tmpdir(),'quality-run-'));try{
  const input=join(root,'samples.json'),versions=join(root,'versions.json'),frozenPath=join(root,'frozen.json'),report=join(root,'report.json');
  const samples=Array.from({length:30},(_,index)=>({id:String(index),url:`https://example.org/${index}`,source_id:index%2?'langchain_blog':'claude_resources',note_paths:[],human_label:'collect',predicted:null,split:index<10?'holdout':'development',human_claims_supported:null,human_claims_checked:null,model_review_passed:null,numeric_errors:null,interface_errors:null,link_errors:null,mechanism_score:null,tradeoff_score:null,boundary_score:null,figure_score:null,feedback:null,cost_usd:null,duration_ms:null,qualified:false,source_snapshot_hash:digest('fixture body '+index)}));
  await writeFile(input,JSON.stringify({samples}));await writeFile(versions,JSON.stringify({config:digest('config'),prompt:digest('prompt'),model:'deepseek-flash',skill_commit:'a'.repeat(40)}));
  await exec('npx',['tsx',script,'freeze','--input',input,'--versions',versions,'--output',frozenPath]);const original=await readFile(frozenPath,'utf8');
  await expect(exec('npx',['tsx',script,'freeze','--input',input,'--versions',versions,'--output',frozenPath])).rejects.toThrow();expect(await readFile(frozenPath,'utf8')).toBe(original);
  const results=samples.map(sample=>({...sample,predicted:'collect'}));await writeFile(input,JSON.stringify({samples:results}));await exec('npx',['tsx',script,'report','--input',input,'--frozen',frozenPath,'--output',report]);
  const actual=JSON.parse(await readFile(report,'utf8'));expect(actual).toMatchObject({quality_gate:'awaiting_user_confirmation',model_version_status:'identifier_only_unverified',evaluation:{cost:{total_usd:null,unknown_samples:30},duration:{total_ms:null,unknown_samples:30}}});
  results[0]!.human_label='reject';await writeFile(input,JSON.stringify({samples:results}));await expect(exec('npx',['tsx',script,'report','--input',input,'--frozen',frozenPath,'--output',join(root,'wrong.json')])).rejects.toThrow('frozen_dataset_binding_mismatch');
 }finally{await rm(root,{recursive:true,force:true});}
});

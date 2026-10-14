import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {intakeManual} from '../../src/collect/intake.js';
import {emptyIdentity,type IdentityState} from '../../src/collect/identity.js';
import {policyFixture} from '../runtime/policy-fixtures.js';
it.each(['source_disabled','global_paused'])('manual intake %s commits a rejected receipt without a candidate and preserves it across a cold restart',async kind=>{
 const root=await mkdtemp(join(tmpdir(),'manual-admission-'));try{
  const store=new FileObjectStore(join(root,'objects')),policy=policyFixture();if(kind==='source_disabled')policy.sources.claude_resources!.enabled=false;else policy.paused=true;
  const open=async(name:string,initialize=false)=>{const manager=new ImmutableWorkspaceManager({store,scope:'production',verify_preflight:false,local_root:join(root,name),record_validator:validateHostRecords});return new WorkspaceJournal(manager,await manager.restore('obs-notes-hub/reading',{allow_initialize:initialize}),name);};
  let journal=await open('first',true);const gate=()=>new PolicyGate(async()=>policy,check=>journal.commit('policy-checks/'+check.check_id,check));const port=()=>({read:async()=>await journal.load<IdentityState>('identity')??emptyIdentity(),commit:async(state:IdentityState,reason:string)=>journal.commitMany({identity:state},reason)});
  const input={submission_id:'manual_rejected',urls:['https://claude.com/resources/articles/tutorial'],submitted_by:'owner',submitted_at:'2026-10-14T00:00:00Z',execution_scope:'production' as const};
  const receipt=await intakeManual(port(),gate(),input);expect(receipt.items[0]).toMatchObject({status:'rejected',candidate_id:null,project_id:null,pr_number:null});expect(receipt.items[0]!.reason_codes.some(reason=>reason.startsWith(kind))).toBe(true);
  await rm(join(root,'first'),{recursive:true,force:true});journal=await open('cold');const state=(await journal.load<IdentityState>('identity'))!;expect(state.candidates).toEqual({});expect(state.submissions.manual_rejected).toEqual(receipt);
  const revision=journal.handle.revision;expect(await intakeManual(port(),gate(),input)).toEqual(receipt);expect(journal.handle.revision).toBe(revision);expect(journal.keys('projects/')).toEqual([]);expect(journal.keys('invocations/')).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});

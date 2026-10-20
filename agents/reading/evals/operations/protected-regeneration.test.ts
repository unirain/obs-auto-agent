import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm,stat,readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse as yaml} from 'yaml';
import {canonicalJson,sha256} from '../../src/contracts/index.js';
import {prepareProtectedRegeneration,validateProtectedRegeneration} from '../../src/app/protected-regeneration.js';
const envelope=()=>({schema_version:1,preview_id:'isolated',actor:'operator',runtime:{image_id:'sha256:'+'a'.repeat(64),manifest_hash:'b'.repeat(64)},request:{schema_version:1,action:'new_generation',recovery_id:'r1',project_id:'p1',expected_revision:'revision1',reason:'approved runtime refresh',evidence_reference:'receipt1',guidance:'changed operator input',refresh_runtime:true}});
const binding=(value:unknown)=>({payload_sha256:sha256(canonicalJson(value)),preview_id:'isolated',actor:'operator'});
it('writes only the approved typed request after hash/scope/actor verification, with private permissions and no replacement',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'protected-regeneration-')));try{
 const row=envelope(),result=await prepareProtectedRegeneration(JSON.stringify(row,null,2)+'\n',binding(row),join(root,'prepared'));
 expect(JSON.parse(await readFile(result.request_file,'utf8'))).toEqual(row.request);expect((await stat(result.request_file)).mode&0o777).toBe(0o600);expect(result.image_id).toBe(row.runtime.image_id);
 await expect(prepareProtectedRegeneration(JSON.stringify(row),binding(row),join(root,'prepared'))).rejects.toThrow('directory_invalid');expect((await readdir(join(root,'prepared')))).toEqual(['request.json']);expect(JSON.parse(await readFile(result.request_file,'utf8'))).toEqual(row.request);
 }finally{await rm(root,{recursive:true,force:true});}
});
it.each(['hash','actor','scope','schema','action','no_refresh','skill','unknown_field'] as const)('rejects %s before file creation or runtime/OSS effects',async kind=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'protected-regeneration-')));try{const row:any=envelope(),bound=binding(row);
 if(kind==='hash')bound.payload_sha256='0'.repeat(64);if(kind==='actor')bound.actor='another';if(kind==='scope')bound.preview_id='another';if(kind==='schema')row.schema_version=2;if(kind==='action')row.request.action='unblock';if(kind==='no_refresh')row.request.refresh_runtime=false;if(kind==='skill')row.request.approved_skill_commit='c'.repeat(40);if(kind==='unknown_field')row.command='execute source';
 if(!['hash','actor','scope'].includes(kind))bound.payload_sha256=sha256(canonicalJson(row));
 await expect(prepareProtectedRegeneration(JSON.stringify(row),bound,join(root,'prepared'))).rejects.toThrow('protected_regeneration_invalid');expect(await readdir(root)).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('keeps regeneration under the shared Actions mutex with only preview/capacity/read credentials and no public body',async()=>{
 const workflow=yaml(await readFile('.github/workflows/reading-preview-regenerate.yml','utf8'));
 expect(workflow.concurrency).toEqual({group:'reading-workspace-writer','cancel-in-progress':false});expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual(['payload_sha256','preview_id']);
 expect(workflow.jobs.regenerate.environment).toBe('reading-preview');expect(workflow.jobs.regenerate.if).toContain('default_branch');
 const text=JSON.stringify(workflow);for(const denied of ['DEEPSEEK_API_KEY','ANTHROPIC_API_KEY','OSS_TEST_CREDENTIALS','OSS_WORKSPACE_CREDENTIALS','GITHUB_APP','OSS_IMAGE_CREDENTIALS'])expect(text).not.toContain(denied);
 for(const step of workflow.jobs.regenerate.steps){if(step.uses)expect(step.uses).toMatch(/@[a-f0-9]{40}$/);if(step.run)expect(step.run).not.toContain('${{ inputs.');}
 expect(text).toContain("'--fixed-image',request.image_id");expect(text).not.toContain('docker build');
});

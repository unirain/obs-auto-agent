import {it,expect} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {renderFixture} from './render-fixture.js';
import {renderDiagram} from '../../src/tools/render.js';
import {inspectToolsRuntime} from '../../src/tools/sandbox.js';
it.skipIf(process.env.READING_LIVE_RENDER_EXIT!=='1')('actual isolated Docker process exit retains checked sources and a cold host exports them without a model query',async()=>{
 const f=await renderFixture(resolve('.reading-local'));try{
  const runtime=await inspectToolsRuntime(process.env.READING_TOOLS_IMAGE),binding={image_id:runtime.image_id,manifest_hash:runtime.manifest_hash};
  await expect(renderDiagram(f.bundle,f.input,Date.now()+240000,binding,f.persistence)).rejects.toMatchObject({code:42});
  const first=await f.commands(f.bundle);expect(first).toEqual(['validate','render','check','export-png']);
  const cold=await f.cold(),image=await renderDiagram(cold.bundle,f.input,Date.now()+240000,binding,cold.persistence);
  expect(await f.commands(cold.bundle)).toEqual(['export-png']);expect(image.visual_check).toBe('pending');expect(cold.journal.keys('invocations/')).toEqual([]);
  if(process.env.READING_RENDER_EVIDENCE)await writeFile(process.env.READING_RENDER_EVIDENCE,JSON.stringify({schema_version:1,recorded_at:new Date().toISOString(),runtime:binding,scope:'Actual local isolated Docker fault with fixed fixture script; not real drawing skill/model/quality acceptance.',fixture_skill_hash:f.bundle.hash,exit_code:42,first_commands:first,cold_commands:await f.commands(cold.bundle),source_hash:image.source_hash,png_hash:image.png_hash,model_queries:0,visual_check:image.visual_check},null,2)+'\n',{flag:'wx'});
 }finally{await f.cleanup();}
},300000);

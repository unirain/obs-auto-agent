import {it,expect} from 'vitest';
import {renderFixture} from './render-fixture.js';
import {renderDiagram,parseRenderSourceReceipt} from '../../src/tools/render.js';
import {digest} from '../../src/stages/contracts.js';
it('renderer process exit preserves checked sources and prior evidence; a fresh host resumes only export from the immutable checkpoint',async()=>{
 const f=await renderFixture();try{
  await expect(renderDiagram(f.bundle,f.input,Date.now()+30000,undefined,f.persistence,f.native(f.bundle))).rejects.toMatchObject({code:42});
  expect(await f.commands(f.bundle)).toEqual(['validate','render','check','export-png']);
  expect(f.journal.handle.snapshot.manifest.files.filter(file=>file.path.includes('/draft/'))).toHaveLength(3);
  expect(f.journal.handle.snapshot.manifest.files.some(file=>file.path.endsWith('.png'))).toBe(false);
  const cold=await f.cold();const receipt=parseRenderSourceReceipt(JSON.parse(Buffer.from(cold.rendered['图文件/render_project/core.render-check.json']!).toString()));
  expect(receipt.source_hash).toBe(digest(cold.rendered['图文件/render_project/core.svg']!));
  expect(Buffer.from(await cold.manager.readFile(cold.journal.handle,'projects/render_project/sources/prior.txt')).toString()).toContain('Previously inspected');
  const image=await renderDiagram(cold.bundle,f.input,Date.now()+30000,undefined,cold.persistence,f.native(cold.bundle));
  expect(await f.commands(cold.bundle)).toEqual(['export-png']);expect(image).toMatchObject({width:1,height:1,visual_check:'pending',source_hash:receipt.source_hash});
  expect(cold.journal.keys('invocations/')).toEqual([]); // this safe host recovery creates no model intent/query
 }finally{await f.cleanup();}
});
it('renderer refuses incomplete, changed source, input and runtime checkpoints without executing a process or claiming visual completion',async()=>{
 const f=await renderFixture();try{
  await expect(renderDiagram(f.bundle,f.input,Date.now()+30000,undefined,f.persistence,f.native(f.bundle))).rejects.toMatchObject({code:42});
  const cold=await f.cold(),base='图文件/render_project/core',svg=cold.rendered[base+'.svg']!;
  await expect(renderDiagram(cold.bundle,{...f.input,diagram:{changed:true}},Date.now()+30000,undefined,cold.persistence,f.native(cold.bundle))).rejects.toThrow('input_changed');
  await expect(renderDiagram({...cold.bundle,hash:digest('different runtime')},f.input,Date.now()+30000,undefined,cold.persistence,f.native(cold.bundle))).rejects.toThrow('runtime_changed');
  cold.rendered[base+'.svg']=Buffer.from('changed source');await expect(renderDiagram(cold.bundle,f.input,Date.now()+30000,undefined,cold.persistence,f.native(cold.bundle))).rejects.toThrow('source_changed');
  cold.rendered[base+'.svg']=svg;delete cold.rendered[base+'.json'];await expect(renderDiagram(cold.bundle,f.input,Date.now()+30000,undefined,cold.persistence,f.native(cold.bundle))).rejects.toThrow('incomplete');
  expect(cold.journal.handle.snapshot.manifest.files.some(file=>file.path.endsWith('.png'))).toBe(false);expect(cold.journal.keys('invocations/')).toEqual([]);
 }finally{await f.cleanup();}
});

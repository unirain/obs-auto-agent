import {it,expect} from 'vitest';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Ajv} from 'ajv';
import {TypeCompiler} from '@sinclair/typebox/compiler';
import {SCHEMA_DOCUMENTS} from '../schema-documents.js';
it('every published contract is registered once, compiles in both validators and matches its authoritative schema',async()=>{
 const declared=new Set(SCHEMA_DOCUMENTS.map(item=>item.file));
 const actual=(await readdir('agents/reading/schemas')).filter(file=>file.endsWith('.schema.json'));
 expect([...declared].sort()).toEqual(actual.sort());
 for(const item of SCHEMA_DOCUMENTS){
  const raw=await readFile(join('agents/reading/schemas',item.file),'utf8');expect(raw,item.name).toBe(JSON.stringify(item.schema,null,2)+'\n');
  expect(()=>TypeCompiler.Compile(item.schema),item.name).not.toThrow();
  const ajv=new Ajv({strict:true,allErrors:true});expect(()=>ajv.compile(JSON.parse(raw)),item.name).not.toThrow();
 }
});

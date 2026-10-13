import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {SCHEMA_DOCUMENTS} from './schema-documents.js';
const check=process.argv.includes('--check');
for(const item of SCHEMA_DOCUMENTS){const path=resolve('agents/reading/schemas',item.file),bytes=JSON.stringify(item.schema,null,2)+'\n';if(check){if(await readFile(path,'utf8')!==bytes)throw new Error('schema_document_drift:'+item.name);}else await writeFile(path,bytes);}
console.log(JSON.stringify({schemas:SCHEMA_DOCUMENTS.length,mode:check?'checked':'generated'}));

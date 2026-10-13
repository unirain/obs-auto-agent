import {SHARED_SCHEMA_DOCUMENTS} from '../src/contracts/schema.js';
import {AGENT_SCHEMA_DOCUMENTS} from '../src/stages/records.js';
import {PUBLISH_SCHEMA_DOCUMENTS} from '../src/publish/contracts.js';
import {MONITOR_SCHEMA_DOCUMENTS} from '../src/monitor/contracts.js';
import {CONFIG_SCHEMA_DOCUMENTS} from '../src/config/schemas.js';
import {RunReportSchema} from '../src/app/run-records.js';
export const SCHEMA_DOCUMENTS=[...SHARED_SCHEMA_DOCUMENTS,...AGENT_SCHEMA_DOCUMENTS,...PUBLISH_SCHEMA_DOCUMENTS,...MONITOR_SCHEMA_DOCUMENTS,...CONFIG_SCHEMA_DOCUMENTS,{name:'run_report',file:'run-report.schema.json',schema:RunReportSchema}];
const names=new Set<string>(),files=new Set<string>();
for(const entry of SCHEMA_DOCUMENTS){if(names.has(entry.name)||files.has(entry.file)||!/^[a-z0-9-]+\.schema\.json$/.test(entry.file))throw new Error('schema_document_identity_conflict');names.add(entry.name);files.add(entry.file);}

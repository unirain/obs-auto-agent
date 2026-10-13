import {digest,type Scope} from '../stages/contracts.js';
import type {Usage} from '../contracts/index.js';
import type {Writing} from '../stages/validation.js';
export type PreviewReport={schema_version:1;execution_scope:'preview';project_id:string;workspace_id:string;state:'preview_ready'|'skipped'|'deferred';file_hashes:Record<string,string>;degradations:string[];usage:Usage;checks:{formal_upload:'not_exercised';formal_url:'not_exercised';github_pr:'not_exercised'};generated_at:string};
export function previewReport(scope:Scope,workspace_id:string,project_id:string,state:PreviewReport['state'],writing:Writing|null,files:Record<string,Uint8Array>,usage:Usage,now:Date):PreviewReport {
  if(scope!=='preview'||!workspace_id.startsWith('obs-notes-hub/reading-preview/'))throw new Error('preview_scope_required');
  return {schema_version:1,execution_scope:'preview',project_id,workspace_id,state,file_hashes:Object.fromEntries(Object.entries(files).map(([file,bytes])=>[file,digest(bytes)])),degradations:writing?.degradations??[],usage,
    checks:{formal_upload:'not_exercised',formal_url:'not_exercised',github_pr:'not_exercised'},generated_at:now.toISOString()};
}

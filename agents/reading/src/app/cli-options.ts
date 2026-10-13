import { parseArgs } from 'node:util';
import { parseDispatch,type Dispatch } from '../config/dispatch.js';

export type CliOptions={command:'run'|'validate-dispatch'|'watchdog'|'status'|'verify-storage'|'maintenance';deployment:string;dispatch:Dispatch|null;
  local:boolean;local_root:string;notes_repository:string|null;from_actions:boolean};
export function parseCli(args:string[],env:NodeJS.ProcessEnv={}):CliOptions{
  const {values,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{
    deployment:{type:'string'},'from-actions':{type:'boolean',default:false},mode:{type:'string'},
    'input-url':{type:'string',multiple:true},'input-urls':{type:'string'},'project-id':{type:'string'},
    'preview-id':{type:'string'},'submission-id':{type:'string'},local:{type:'boolean',default:false},
    'local-root':{type:'string',default:'.reading-local'},'notes-repository':{type:'string'},
  }});
  const command=positionals[0];
  if(positionals.length!==1||!command||!['run','validate-dispatch','watchdog','status','verify-storage','maintenance'].includes(command))throw new Error('invalid_command');
  if(!values.deployment)throw new Error('deployment_file_required');
  const from_actions=Boolean(values['from-actions']);
  const actionInput={mode:env.READING_MODE,input_urls:env.READING_INPUT_URLS_JSON??'[]',project_id:env.READING_PROJECT_ID,preview_id:env.READING_PREVIEW_ID,submission_id:env.READING_SUBMISSION_ID};
  const explicit={mode:values.mode,input_urls:values['input-urls']??values['input-url']??[],project_id:values['project-id'],preview_id:values['preview-id'],submission_id:values['submission-id']};
  const useAction=from_actions||command==='validate-dispatch'&&env.READING_MODE!==undefined;
  if(values['input-url']&&values['input-urls'])throw new Error('ambiguous_url_inputs');
  const dispatch=['run','validate-dispatch','maintenance'].includes(command)?parseDispatch(useAction?actionInput:explicit,useAction&&env.READING_TRIGGER==='schedule'?'schedule':'manual'):null;
  if(command==='maintenance'&&(dispatch?.input_urls.length||dispatch?.project_id||dispatch?.submission_id||(dispatch?.mode==='preview'&&!dispatch.preview_id)))throw new Error('maintenance_existing_workspace_only');
  if(values.local&&dispatch?.mode!=='preview')throw new Error('local_adapter_is_preview_only');
  return {command:command as CliOptions['command'],deployment:values.deployment,dispatch,local:Boolean(values.local),local_root:values['local-root']!,notes_repository:values['notes-repository']??env.READING_NOTES_REPOSITORY??null,from_actions};
}
export function safeError(error:unknown):string{
  const message=error instanceof Error?error.message:'operation_failed';
  return message.replace(/LTAI[A-Za-z0-9]+|sk-ant-[A-Za-z0-9_-]+/g,'[redacted]').replace(/-----BEGIN[\s\S]*?-----END[^\n]*-----/g,'[redacted]').replace(/([?&](?:Signature|SecurityToken|AccessKeyId)=)[^&\s]+/gi,'$1[redacted]').slice(0,300);
}

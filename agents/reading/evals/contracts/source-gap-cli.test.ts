import {it,expect} from 'vitest';
import {parseCli} from '../../src/app/cli-options.js';
it('source gap management only targets an existing workspace and requires an explicit private request file',()=>{
 const base=['--deployment','deployment.json','--mode','scheduled'];
 expect(parseCli(['inspect-source-gaps',...base]).command).toBe('inspect-source-gaps');
 expect(parseCli(['manage-source-gap',...base,'--request-file','private-request.json']).request_file).toBe('private-request.json');
 expect(()=>parseCli(['manage-source-gap',...base])).toThrow('source_gap_request_file_required');
 expect(()=>parseCli(['inspect-source-gaps',...base,'--request-file','request.json'])).toThrow('request_wrong_command');
 expect(()=>parseCli(['manage-source-gap',...base,'--request-file','request.json','--input-url','https://example.org/article','--submission-id','new-job'])).toThrow('existing_workspace_only');
 expect(()=>parseCli(['manage-source-gap','--deployment','deployment.json','--mode','resume','--project-id','existing-project','--request-file','request.json'])).toThrow('existing_workspace_only');
 expect(()=>parseCli(['manage-source-gap',...base,'--request-file','request.json','--local'])).toThrow('preview_only');
});

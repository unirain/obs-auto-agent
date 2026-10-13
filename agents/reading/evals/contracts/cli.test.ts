import { describe,it,expect } from 'vitest';
import { parseCli,safeError } from '../../src/app/cli-options.js';

describe('trusted CLI entrypoint',()=>{
  it('defaults manual URL work to preview and treats URLs as data',()=>{
    const parsed=parseCli(['run','--deployment','preview.json','--input-url','https://example.org/a?title=$not_shell']);
    expect(parsed.dispatch?.mode).toBe('preview');expect(parsed.dispatch?.input_urls).toHaveLength(1);
  });
  it('parses typed Actions inputs and rejects cross-mode data',()=>{
    expect(parseCli(['run','--from-actions','--deployment','p.json'],{READING_MODE:'scheduled',READING_TRIGGER:'manual',READING_INPUT_URLS_JSON:'["https://example.org/a"]'}).dispatch?.mode).toBe('scheduled');
    expect(()=>parseCli(['run','--deployment','p.json','--mode','publish-only','--project-id','p1','--input-url','https://example.org/a'])).toThrow();
    expect(()=>parseCli(['run','--deployment','p.json','--mode','scheduled','--local'])).toThrow('preview_only');
  });
  it('never echoes access key IDs or signed request parameters in errors',()=>{
    const result=safeError(new Error('LTAIexampleKey https://oss.aliyuncs.com/?Signature=secret&AccessKeyId=secret'));
    expect(result).not.toContain('secret');expect(result).not.toContain('LTAIexampleKey');
  });
  it('maintenance targets an existing workspace without creating a new preview or admitting URLs',()=>{
    expect(parseCli(['maintenance','--deployment','p.json','--mode','preview','--preview-id','existing']).dispatch?.preview_id).toBe('existing');
    expect(parseCli(['maintenance','--deployment','p.json','--mode','scheduled']).command).toBe('maintenance');
    expect(()=>parseCli(['maintenance','--deployment','p.json'])).toThrow('existing preview_id');
    expect(()=>parseCli(['maintenance','--deployment','p.json','--mode','scheduled','--input-url','https://example.org/a'])).toThrow('maintenance_existing_workspace_only');
  });
});

import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {it,expect,vi} from 'vitest';
import {sdkOptions} from '../../src/runtime/sdk.js';

it('installed SDK hands its actual subprocess a replacement environment without inherited controller credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sdk-spawn-proof-')),output=join(root,'environment.json');
  vi.stubEnv('OSS_ACCESS_KEY_SECRET','sentinel-oss');vi.stubEnv('GITHUB_TOKEN','sentinel-github');vi.stubEnv('DEEPSEEK_API_KEY','sentinel-controller');vi.stubEnv('UNRELATED_PRIVATE_SECRET','sentinel-other');
  let spawned=false;const options=sdkOptions({prompt:'unused',system_prompt:'unused',schema:{type:'object'},cwd:root,model:'fake-no-model-call',signal:new AbortController().signal,tools:[]},{provider:'deepseek',api_key:'allowed-model-only',base_url:'https://api.deepseek.com/anthropic'},root);
  options.spawnClaudeCodeProcess=actual=>{spawned=true;expect(actual.env).not.toHaveProperty('OSS_ACCESS_KEY_SECRET');expect(actual.env).not.toHaveProperty('GITHUB_TOKEN');expect(actual.env).not.toHaveProperty('DEEPSEEK_API_KEY');expect(actual.env).not.toHaveProperty('UNRELATED_PRIVATE_SECRET');return spawn(process.execPath,['-e',`require('node:fs').writeFileSync(process.argv[1],JSON.stringify(process.env));process.exit(1)`,output],{env:actual.env,cwd:actual.cwd,stdio:['pipe','pipe','pipe']});};
  const session=query({prompt:'No Claude executable or model is launched in this test.',options});try{await expect((async()=>{for await(const _ of session){}})()).rejects.toThrow();expect(spawned).toBe(true);const child=JSON.parse(await readFile(output,'utf8'));expect(child.ANTHROPIC_AUTH_TOKEN).toBe('allowed-model-only');for(const key of ['OSS_ACCESS_KEY_SECRET','GITHUB_TOKEN','DEEPSEEK_API_KEY','UNRELATED_PRIVATE_SECRET'])expect(child).not.toHaveProperty(key);}finally{session.close();vi.unstubAllEnvs();}
},15_000);

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOssCredentials } from '../../src/config/credentials.js';

describe('host credential injection', () => {
  it('loads explicit env without copying credentials into runtime state', async () => {
    expect(await loadOssCredentials({OSS_ACCESS_KEY_ID:'test-id',OSS_ACCESS_KEY_SECRET:'test-secret'})).toEqual({accessKeyId:'test-id',accessKeySecret:'test-secret'});
    await expect(loadOssCredentials({OSS_ACCESS_KEY_ID:'only-id'})).rejects.toThrow('incomplete');
  });
  it('reads only the bounded explicitly selected account section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reading-credentials-'));
    try {
      const file = join(dir,'personal.md');
      await writeFile(file,'### 阿里云 ak sk\nak：fixtureID\nsk：fixtureSecret\n### Other account\nak：otherID\nsk：otherSecret\n');
      expect(await loadOssCredentials({OSS_CREDENTIALS_FILE:file})).toEqual({accessKeyId:'fixtureID',accessKeySecret:'fixtureSecret'});
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
});

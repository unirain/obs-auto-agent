import { readFile } from 'node:fs/promises';

export interface OssCredentials { accessKeyId: string; accessKeySecret: string; stsToken?: string }

/** Host-only credential loading. Never pass this object into WorkspaceHandle or model tools. */
export async function loadOssCredentials(env: NodeJS.ProcessEnv = process.env): Promise<OssCredentials> {
  const id = env.OSS_ACCESS_KEY_ID;
  const secret = env.OSS_ACCESS_KEY_SECRET;
  if (id && secret) return { accessKeyId: id, accessKeySecret: secret, ...(env.OSS_SECURITY_TOKEN ? { stsToken: env.OSS_SECURITY_TOKEN } : {}) };
  if (id || secret) throw new Error('oss_credentials_incomplete');
  if (!env.OSS_CREDENTIALS_FILE) throw new Error('oss_credentials_unconfigured');
  const content = await readFile(env.OSS_CREDENTIALS_FILE, 'utf8');
  const section = /(?:^|\n)#{1,6}\s*阿里云\s+ak\s+sk\s*\r?\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(content)?.[1];
  if (!section) throw new Error('oss_credential_section_missing');
  const accessKeyId = /^\s*ak\s*[:：]\s*`?([A-Za-z0-9]+)`?\s*$/im.exec(section)?.[1];
  const accessKeySecret = /^\s*sk\s*[:：]\s*`?([A-Za-z0-9+/=_-]+)`?\s*$/im.exec(section)?.[1];
  if (!accessKeyId || !accessKeySecret) throw new Error('oss_credential_section_invalid');
  return { accessKeyId, accessKeySecret };
}

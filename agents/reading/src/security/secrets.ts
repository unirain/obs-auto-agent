import {AgentError} from '../contracts/index.js';
export type SecretContentGuard=(bytes:Uint8Array)=>void;
/** Host-only closure. Neither the secret values nor matching payloads enter receipts/errors. */
export function createSecretGuard(values:readonly string[]=[]):SecretContentGuard{
 const patterns=new Map<string,Buffer>();
 for(const value of values){if(value.length<8)continue;for(const encoded of [value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value),Buffer.from(value).toString('base64'),Buffer.from(value).toString('base64url')])patterns.set(encoded,Buffer.from(encoded));}
 const needles=[...patterns.values()];
 return bytes=>{const buffer=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(needles.some(needle=>buffer.includes(needle)))throw new AgentError('corrupt','Sensitive content is excluded');const text=buffer.toString('utf8');if(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bLTAI[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{24,}\b/.test(text))throw new AgentError('corrupt','Sensitive content is excluded');};
}
export function secretGuardFromEnvironment(env:NodeJS.ProcessEnv,extra:readonly string[]=[]):SecretContentGuard{
 const values=[...extra],fields=new Set(['accesskeyid','accesskeysecret','ststoken','privatekey','apikey','token','password','secret']);
 const visit=(value:unknown)=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(typeof item==='string'&&fields.has(key.replaceAll('_','').toLowerCase()))values.push(item);else if(item&&typeof item==='object')visit(item);}};
 for(const [name,value]of Object.entries(env)){if(!value)continue;if(/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS)$/.test(name))values.push(value);try{visit(JSON.parse(value));}catch{/* Plain value or a non-secret configuration reference. */}}
 return createSecretGuard(values);
}

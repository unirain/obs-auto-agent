import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {digest} from '../stages/contracts.js';
import {toolEnvironment} from './files.js';
import type {MaterialSnapshot} from './evidence.js';
import {SandboxRunner} from './sandbox.js';
const exec=promisify(execFile);
export function pdfTextLinks(pages:string[],annotations=''):{url:string;page:number|null}[]{
  const links=new Map<string,{url:string;page:number|null}>();
  const add=(text:string,page:number|null)=>{for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)){const raw=match[0].replace(/[.,;\])]+$/,'');try{const url=new URL(raw);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)links.set(url.href,{url:url.href,page});}catch{}}};
  pages.forEach((page,index)=>add(page,index+1));for(const line of annotations.split('\n'))add(line,Number(/^\s*(\d+)/.exec(line)?.[1])||null);return [...links.values()];
}
export async function extractPdf(bytes:Uint8Array,url:string,root:string,deadline:number,max_pages=100):Promise<MaterialSnapshot>{
  if(!Buffer.from(bytes.slice(0,5)).equals(Buffer.from('%PDF-'))||!Buffer.from(bytes.slice(-2048)).includes(Buffer.from('%%EOF')))throw new Error('pdf_truncated_or_invalid');
  const dir=path.join(root,'scratch','pdf',digest(bytes));await mkdir(dir,{recursive:true});const input=path.join(dir,'source.pdf');const output=path.join(dir,'source.txt');await writeFile(input,bytes);
  const remaining=deadline-Date.now();if(remaining<=0)throw new Error('run_deadline');const environment=toolEnvironment(root);
  const sandbox=new SandboxRunner();const mount=[{source:dir,target:'/workspace/pdf',readonly:false}];
  const info=await sandbox.run('pdfinfo',['/workspace/pdf/source.pdf'],mount,deadline);const pagesCount=Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1]);if(!pagesCount||pagesCount>max_pages)throw new Error('pdf_page_limit');
  await sandbox.run('pdftotext',['-layout','-enc','UTF-8','/workspace/pdf/source.pdf','/workspace/pdf/source.txt'],mount,deadline);const rawText=await readFile(output,'utf8');const pages=rawText.split('\f').map(page=>page.trim());if(pages.length===pagesCount+1&&pages.at(-1)==='')pages.pop();const text=pages.join('\n\f\n');
  if(pages.length!==pagesCount)throw new Error('pdf_page_extraction_incomplete');const annotations=await sandbox.run('pdfinfo',['-url','/workspace/pdf/source.pdf'],mount,deadline);const link_locators=pdfTextLinks(pages,annotations);
  return {url,text,hash:digest(text),retrieved_at:new Date().toISOString(),links:link_locators.map(link=>link.url),link_locators,kind:'pdf',pages};
}

import {assertUtcInstant} from '../contracts/utc.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import * as cheerio from 'cheerio';
import {digest} from '../stages/contracts.js';
export type DnsAddress={address:string;family:number};
export function isPublicAddress(raw:string):boolean {
  const address=raw.toLowerCase().replace(/^\[|\]$/g,'');const family=isIP(address);
  if(family===4){const [a=0,b=0,c=0]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));}
  if(family===6)return /^[23]/.test(address)&&!address.startsWith('2001:db8:')&&!address.startsWith('2001:0:')&&!address.startsWith('2002:');
  return false;
}
export type GatewayReply={status:number;headers:Record<string,string>;body:Uint8Array};
/** Host-only admission and payload observation; never serialized into a model input. */
export type GatewayDownloadBudget={begin():Promise<void>;consume(bytes:number):Promise<void>;remaining():number};
export type GatewayTransport=(url:URL,address:DnsAddress,options:{max_bytes:number;timeout_ms:number;deadline?:number;signal?:AbortSignal;on_body_bytes?:(bytes:number)=>Promise<void>})=>Promise<GatewayReply>;
const nativeTransport:GatewayTransport=(url,address,options)=>new Promise((resolve,reject)=>{
  let responseStream:import('node:http').IncomingMessage|undefined,finished=false,failure:unknown;
  const pending=new Set<Promise<void>>();let deadlineTimer:ReturnType<typeof setTimeout>|undefined,networkTimer:ReturnType<typeof setTimeout>|undefined;
  let networkRemaining=options.timeout_ms,networkStarted:number|undefined;
  const pauseNetwork=()=>{clearTimeout(networkTimer);if(networkStarted!==undefined){networkRemaining-=Date.now()-networkStarted;networkStarted=undefined;}request.setTimeout(0);};
  const clearTimers=()=>{clearTimeout(deadlineTimer);clearTimeout(networkTimer);request.setTimeout(0);};
  const resumeNetwork=()=>{if(finished||failure)return;if(networkRemaining<=0){fail(new Error('source_timeout'));return;}networkStarted=Date.now();networkTimer=setTimeout(()=>fail(new Error('source_timeout')),networkRemaining);networkTimer.unref();};
  const drain=async()=>{while(pending.size)await Promise.allSettled([...pending]);};
  const settle=()=>{if(finished)return;void drain().then(()=>{if(finished)return;if(failure){finished=true;clearTimers();reject(failure);}});};
  const fail=(error:unknown)=>{failure??=error;clearTimers();responseStream?.destroy();request.destroy();settle();};
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',headers:{'User-Agent':'obs-reading-agent/1.0','Accept':'text/html,application/pdf,text/plain,application/json,image/png,image/jpeg,image/webp','Accept-Encoding':'identity'},
    // DNS is pinned. Each payload callback completes before resuming the response.
    lookup:(_host,lookupOptions,callback)=>{
      if(lookupOptions.all)(callback as unknown as (error:null,addresses:DnsAddress[])=>void)(null,[address]);else callback(null,address.address,address.family);
    },signal:options.signal},response=>{
    if(finished||failure){response.destroy();return;}responseStream=response;const headers:Record<string,string>={};for(const [key,value] of Object.entries(response.headers))if(value!==undefined)headers[key]=Array.isArray(value)?value.join(','):value;
    const chunks:Buffer[]=[];let total=0;
    response.on('data',(chunk:Buffer)=>{
      if(finished||failure)return;response.pause();pauseNetwork();total+=chunk.length;const observedTotal=total;
      const task=(async()=>{await options.on_body_bytes?.(chunk.length);if(observedTotal>options.max_bytes)throw new Error('download_size_limit');chunks.push(chunk);})();
      pending.add(task);void task.then(()=>{if(!failure){resumeNetwork();if(!failure)response.resume();}},fail).finally(()=>pending.delete(task));
    });
    response.on('error',fail);response.on('aborted',()=>fail(new Error('truncated_download')));
    response.on('end',()=>{pauseNetwork();void drain().then(()=>{if(finished)return;finished=true;clearTimers();if(failure)reject(failure);else resolve({status:response.statusCode??0,headers,body:Buffer.concat(chunks)});});});
  });request.on('error',fail);
  // Persistent host accounting applies backpressure. It is not network wait time;
  // the independent absolute project deadline still includes every checkpoint.
  if(options.deadline!==undefined){deadlineTimer=setTimeout(()=>fail(new Error('run_deadline')),Math.max(0,options.deadline-Date.now()));deadlineTimer.unref();}
  resumeNetwork();request.end();
});
export class UrlGateway {
  constructor(private readonly authorize:(url:string)=>Promise<void>,private readonly resolve:(host:string)=>Promise<DnsAddress[]>=host=>lookup(host,{all:true}),private readonly transport:GatewayTransport=nativeTransport,
    private readonly config={max_bytes:10_000_000,timeout_ms:30_000,max_redirects:5}){}
  async read(raw:string,options:{mime?:string[];deadline?:number;signal?:AbortSignal;download?:GatewayDownloadBudget}={}):Promise<{url:string;mime:string;content_type:string;bytes:Uint8Array;hash:string;redirects:string[]}> {
    let url=new URL(raw),begun=false;const redirects:string[]=[];
    const remaining=()=>{const value=options.download?.remaining()??this.config.max_bytes;if(!Number.isSafeInteger(value)||value<0)throw new Error('download_budget_invalid');return value;};
    const requireStart=()=>{if(options.signal?.aborted)throw new Error('cancelled');if(Date.now()>=(options.deadline??Infinity))throw new Error('run_deadline');if(options.download&&remaining()===0)throw new Error('batch_yield');};
    for(let step=0;step<=this.config.max_redirects;step++) {
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new Error('url_protocol_or_credentials');
      requireStart();await this.authorize(url.href);const hostname=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await this.resolve(hostname);
      if(!addresses.length||addresses.some(address=>!isPublicAddress(address.address)))throw new Error('private_or_metadata_address');requireStart();
      if(!begun){await options.download?.begin();begun=true;}requireStart();
      let observed=0,observationError:unknown,accounting=Promise.resolve(),accepting=true;
      const observe=(bytes:number)=>{if(!accepting)return Promise.reject(new Error('transport_observation_after_completion'));if(!Number.isSafeInteger(bytes)||bytes<0)return Promise.reject(new Error('download_bytes_invalid'));observed+=bytes;const work=accounting.then(()=>options.download?.consume(bytes));accounting=work.then(()=>{},error=>{observationError??=error;});return work;};
      let response:GatewayReply|undefined,transportError:unknown;
      try{response=await this.transport(url,addresses.find(address=>address.family===4)??addresses[0]!,{max_bytes:Math.min(this.config.max_bytes,remaining()),timeout_ms:this.config.timeout_ms,...(options.deadline!==undefined?{deadline:options.deadline}:{}),...(options.signal?{signal:options.signal}:{}),on_body_bytes:observe});}catch(error){transportError=error;}
      accepting=false;await accounting;if(observationError)throw observationError;if(transportError)throw transportError;if(!response)throw new Error('source_response_missing');
      // Existing complete-response transports need no streaming hook. Account their
      // unreported body exactly once; streaming transports may only omit a suffix.
      if(observed>response.body.length)throw new Error('transport_body_observation_mismatch');
      if(observed<response.body.length)await options.download?.consume(response.body.length-observed);
      if(response.body.length>this.config.max_bytes)throw new Error('download_size_limit');
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.location;if(!location)throw new Error('redirect_without_location');redirects.push(url.href);url=new URL(location,url);continue;
      }
      if(response.status!==200)throw new Error(`source_http_${response.status}`);const mime=(response.headers['content-type']??'').split(';')[0]!.trim().toLowerCase();
      const allowed=options.mime??['text/html','application/pdf','text/plain','application/json','application/rss+xml','application/atom+xml','application/xml','text/xml'];if(!allowed.includes(mime))throw new Error(`source_mime_denied:${mime}`);
      if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new Error('unsupported_content_encoding');
      const expected=Number(response.headers['content-length']);if(response.headers['content-length']&&(!Number.isFinite(expected)||expected!==response.body.length))throw new Error('truncated_download');
      return {url:url.href,mime,content_type:response.headers['content-type']??mime,bytes:response.body,hash:digest(response.body),redirects};
    }throw new Error('redirect_limit');
  }
}
export type WebSnapshot={url:string;hash:string;text:string;links:string[];canonical_url:string|null;title:string;retrieved_at:string;figures:{url:string;caption:string}[]};
export function observedHttpLinks(text:string):string[]{const links=new Set<string>();for(const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)){try{const url=new URL(match[0].replace(/[.,;]+$/,''));if(!url.username&&!url.password)links.add(url.href);}catch{}if(links.size>5000)throw new Error('source_link_count_limit');}return [...links];}
export function extractWebSnapshot(url:string,html:string,retrieved_at:string):WebSnapshot {
  assertUtcInstant(retrieved_at,'web snapshot retrieval time');const $=cheerio.load(html);$('script,style,nav,header,footer,noscript,form').remove();const article=$('article,main,[role="main"],.blog-rich-text').first();const root=article.length?article:$('body');
  root.find('p,h1,h2,h3,h4,li,pre,blockquote,tr').each((_,element)=>{$(element).append('\n');});
  const text=root.text().split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');if(!text)throw new Error('source_empty_body');
  const links=[...new Set([...root.find('a[href]').toArray().map(element=>$(element).attr('href')!).map(href=>{try{return new URL(href,url).href;}catch{return '';}}).filter(href=>/^https?:/.test(href)),...observedHttpLinks(text)])];if(links.length>5000)throw new Error('source_link_count_limit');
  const canonical=$('link[rel="canonical"]').attr('href');const figures=root.find('figure').toArray().flatMap(element=>{const image=$(element).find('img');const src=image.attr('data-src')??image.attr('src');const caption=$(element).find('figcaption').text().trim();return src&&caption?[{url:new URL(src,url).href,caption}]:[];});
  return {url,hash:digest(text),text,links,canonical_url:canonical?new URL(canonical,url).href:null,title:$('title').text()||root.find('h1').text(),retrieved_at,figures};
}

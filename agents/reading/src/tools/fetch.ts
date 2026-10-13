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
export type GatewayTransport=(url:URL,address:DnsAddress,options:{max_bytes:number;timeout_ms:number;signal?:AbortSignal})=>Promise<GatewayReply>;
const nativeTransport:GatewayTransport=(url,address,options)=>new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',headers:{'User-Agent':'obs-reading-agent/1.0','Accept':'text/html,application/pdf,text/plain,application/json,image/png,image/jpeg,image/webp','Accept-Encoding':'identity'},
    // DNS resolution is pinned to the exact address validated above; no second unchecked resolution.
    lookup:(_host,lookupOptions,callback)=>{
      // Node 24+ autoSelectFamily asks for the all-address callback shape. Both shapes still return only the vetted pinned address.
      if(lookupOptions.all)(callback as unknown as (error:null,addresses:DnsAddress[])=>void)(null,[address]);else callback(null,address.address,address.family);
    },signal:options.signal},response=>{
    const headers:Record<string,string>={};for(const [key,value] of Object.entries(response.headers))if(value!==undefined)headers[key]=Array.isArray(value)?value.join(','):value;
    const chunks:Buffer[]=[];let total=0;response.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>options.max_bytes){response.destroy(new Error('download_size_limit'));return;}chunks.push(chunk);});
    response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode??0,headers,body:Buffer.concat(chunks)}));
  });request.on('error',reject);request.setTimeout(options.timeout_ms,()=>request.destroy(new Error('source_timeout')));request.end();
});
export class UrlGateway {
  constructor(private readonly authorize:(url:string)=>Promise<void>,private readonly resolve:(host:string)=>Promise<DnsAddress[]>=host=>lookup(host,{all:true}),private readonly transport:GatewayTransport=nativeTransport,
    private readonly config={max_bytes:10_000_000,timeout_ms:30_000,max_redirects:5}){}
  async read(raw:string,options:{mime?:string[];deadline?:number;signal?:AbortSignal}={}):Promise<{url:string;mime:string;content_type:string;bytes:Uint8Array;hash:string;redirects:string[]}> {
    let url=new URL(raw);const redirects:string[]=[];
    for(let step=0;step<=this.config.max_redirects;step++) {
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new Error('url_protocol_or_credentials');
      if(options.signal?.aborted)throw new Error('cancelled');const timeout=Math.min(this.config.timeout_ms,(options.deadline??Infinity)-Date.now());if(timeout<=0)throw new Error('run_deadline');
      await this.authorize(url.href);const hostname=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await this.resolve(hostname);
      if(!addresses.length||addresses.some(address=>!isPublicAddress(address.address)))throw new Error('private_or_metadata_address');
      const response=await this.transport(url,addresses.find(address=>address.family===4)??addresses[0]!,{max_bytes:this.config.max_bytes,timeout_ms:timeout,...(options.signal?{signal:options.signal}:{})});
      if(response.body.length>this.config.max_bytes)throw new Error('download_size_limit');
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.location;if(!location)throw new Error('redirect_without_location');redirects.push(url.href);url=new URL(location,url);continue;
      }
      if(response.status!==200)throw new Error(`source_http_${response.status}`);const mime=(response.headers['content-type']??'').split(';')[0]!.trim().toLowerCase();
      const allowed=options.mime??['text/html','application/pdf','text/plain','application/json'];if(!allowed.includes(mime))throw new Error(`source_mime_denied:${mime}`);
      if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new Error('unsupported_content_encoding');
      const expected=Number(response.headers['content-length']);if(response.headers['content-length']&&(!Number.isFinite(expected)||expected!==response.body.length))throw new Error('truncated_download');
      return {url:url.href,mime,content_type:response.headers['content-type']??mime,bytes:response.body,hash:digest(response.body),redirects};
    }throw new Error('redirect_limit');
  }
}
export type WebSnapshot={url:string;hash:string;text:string;links:string[];canonical_url:string|null;title:string;retrieved_at:string;figures:{url:string;caption:string}[]};
export function observedHttpLinks(text:string):string[]{const links=new Set<string>();for(const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)){try{const url=new URL(match[0].replace(/[.,;]+$/,''));if(!url.username&&!url.password)links.add(url.href);}catch{}if(links.size>5000)throw new Error('source_link_count_limit');}return [...links];}
export function extractWebSnapshot(url:string,html:string,retrieved_at:string):WebSnapshot {
  const $=cheerio.load(html);$('script,style,nav,header,footer,noscript,form').remove();const article=$('article,main,[role="main"],.blog-rich-text').first();const root=article.length?article:$('body');
  root.find('p,h1,h2,h3,h4,li,pre,blockquote,tr').each((_,element)=>{$(element).append('\n');});
  const text=root.text().split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');if(!text)throw new Error('source_empty_body');
  const links=[...new Set([...root.find('a[href]').toArray().map(element=>$(element).attr('href')!).map(href=>{try{return new URL(href,url).href;}catch{return '';}}).filter(href=>/^https?:/.test(href)),...observedHttpLinks(text)])];if(links.length>5000)throw new Error('source_link_count_limit');
  const canonical=$('link[rel="canonical"]').attr('href');const figures=root.find('figure').toArray().flatMap(element=>{const image=$(element).find('img');const src=image.attr('data-src')??image.attr('src');const caption=$(element).find('figcaption').text().trim();return src&&caption?[{url:new URL(src,url).href,caption}]:[];});
  return {url,hash:digest(text),text,links,canonical_url:canonical?new URL(canonical,url).href:null,title:$('title').text()||root.find('h1').text(),retrieved_at,figures};
}

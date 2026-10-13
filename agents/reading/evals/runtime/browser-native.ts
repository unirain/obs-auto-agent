/** Explicit Docker fixture probe; no external site, credentials or model is used. */
import {writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {UrlGateway} from '../../src/tools/fetch.js';
import {readBrowser} from '../../src/tools/browser.js';
import {readWebMaterial} from '../../src/tools/web-reader.js';
if(!process.env.READING_TOOLS_IMAGE)throw new Error('explicit_tools_image_required');
const url='https://fixture.example/article',shell='<html><head><meta charset="UTF-8"></head><body><main>Loading...</main><script src="/app.js"></script></body></html>';
const requests:string[]=[],transports:string[]=[];let bytes=0;const gateway=new UrlGateway(async requested=>{requests.push(requested);},async()=>[{address:'8.8.8.8',family:4}],async requested=>{transports.push(requested.href);if(requested.hostname!=='fixture.example')throw new Error('fixture_only');return {status:200,headers:{'content-type':requested.pathname==='/app.js'?'application/javascript':'text/html; charset=UTF-8'},body:Buffer.from(requested.pathname==='/app.js'?`document.querySelector('main').innerHTML='<h1>JS hydration mechanism</h1><p>The article was rendered through a typed gateway inside an isolated container.</p>';fetch('http://169.254.169.254/latest').catch(()=>{});`:shell)};});
const deadline=Date.now()+30_000;const loaded=await readWebMaterial(url,shell,new Date().toISOString(),()=>readBrowser(gateway,url,deadline,{download:async size=>{bytes+=size;}}));
if(!loaded.snapshot.text.includes('typed gateway')||transports.some(item=>item.includes('169.254')))throw new Error('browser_isolation_probe_failed');
let capped=false;try{await readBrowser(gateway,url,Date.now()+30_000,{max_requests:1});}catch(error){capped=error instanceof Error&&error.message==='browser_request_limit';}if(!capped)throw new Error('browser_cap_probe_failed');
const image=(await promisify(execFile)('docker',['image','inspect','--format','{{.Id}}',process.env.READING_TOOLS_IMAGE])).stdout.trim();
await writeFile('agents/reading/evals/runtime/evidence/browser-fallback-20261013.json',JSON.stringify({schema_version:1,at:new Date().toISOString(),kind:'isolated_linux_fixture',tools_image:image,capture_method:loaded.method,snapshot_hash:loaded.snapshot.hash,text:loaded.snapshot.text,gateway_requests:requests,transport_requests:transports,download_bytes:bytes,metadata_transport_blocked:true,request_limit_enforced:capped,model_exercised:false,live_external_site_exercised:false},null,2));

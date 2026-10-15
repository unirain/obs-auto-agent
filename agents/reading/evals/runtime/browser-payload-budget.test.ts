import {it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {SandboxRunner} from '../../src/tools/sandbox.js';
import {readBrowser} from '../../src/tools/browser.js';
import {UrlGateway,type GatewayDownloadBudget,type GatewayReply} from '../../src/tools/fetch.js';
afterEach(()=>vi.restoreAllMocks());
function childFixture(){
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()}),close=vi.fn(async()=>{});
 vi.spyOn(SandboxRunner.prototype,'spawn').mockResolvedValue({child,close} as unknown as Awaited<ReturnType<SandboxRunner['spawn']>>);
 return {child,close};
}
it('browser bridge counts intermediate payloads, admits one resource and never adds final bytes twice',async()=>{
 const f=childFixture(),seen:string[]=[];let begins=0,bytes=0;const download:GatewayDownloadBudget={begin:async()=>{begins++;},consume:async count=>{bytes+=count;},remaining:()=>1000-bytes};
 const html='<html><main><h1>Hydrated article</h1><p>Verified mechanism.</p></main></html>',start='https://example.org/start',final='https://example.org/final';
 const gateway=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],async(url):Promise<GatewayReply>=>{seen.push(url.href);return url.href===start?{status:302,headers:{location:final},body:Buffer.from('redirect-body')}:{status:200,headers:{'content-type':'text/html'},body:Buffer.from(html)};});
 f.child.stdin.on('data',chunk=>{const message=JSON.parse(chunk.toString());if(message.type==='init')f.child.stdout.write(JSON.stringify({type:'request',id:1,url:start})+'\n');if(message.type==='reply')f.child.stdout.write(JSON.stringify({type:'result',url:final,html})+'\n');});
 const legacy=vi.fn();expect((await readBrowser(gateway,start,Date.now()+10000,{download_budget:download,download:legacy})).text).toContain('Verified mechanism.');expect(bytes).toBe(Buffer.byteLength(html)+13);expect(begins).toBe(1);expect(legacy).not.toHaveBeenCalled();expect(seen).toEqual([start,final]);expect(f.close).toHaveBeenCalledOnce();
});
it('browser success/closure drains accounting already started by an outstanding resource before returning',async()=>{
 const f=childFixture();let release!:()=>void,entered!:()=>void,returned=false,bytes=0;const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const gateway=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],async()=>({status:200,headers:{'content-type':'text/plain'},body:Buffer.from('abc')}));
 f.child.stdin.on('data',chunk=>{if(JSON.parse(chunk.toString()).type==='init')f.child.stdout.write(JSON.stringify({type:'request',id:1,url:'https://example.org/resource'})+'\n');});
 const read=readBrowser(gateway,'https://example.org/a',Date.now()+10000,{download_budget:{begin:async()=>{},remaining:()=>100,consume:async count=>{entered();await barrier;bytes+=count;}}}).then(value=>{returned=true;return value;});
 await started;f.child.stdout.write(JSON.stringify({type:'result',url:'https://example.org/a',html:'<html><main><p>Complete text material.</p></main></html>'})+'\n');await new Promise(resolve=>setTimeout(resolve,10));expect(returned).toBe(false);release();await read;expect(bytes).toBe(3);expect(f.close).toHaveBeenCalledOnce();
});
it.each(['begin','consume'] as const)('browser cannot turn a host %s checkpoint failure into a successful document',async phase=>{
 const f=childFixture(),error=new Error('checkpoint_write_unknown');let requests=0;
 const html='<html><main><p>Worker still claims success.</p></main></html>';
 const gateway=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],async()=>{requests++;return {status:200,headers:{'content-type':'text/plain'},body:Buffer.from('abc')};});
 f.child.stdin.on('data',chunk=>{const message=JSON.parse(chunk.toString());if(message.type==='init')f.child.stdout.write(JSON.stringify({type:'request',id:1,url:'https://example.org/resource'})+'\n');if(message.type==='reply')f.child.stdout.write(JSON.stringify({type:'result',url:'https://example.org/a',html})+'\n');});
 await expect(readBrowser(gateway,'https://example.org/a',Date.now()+10000,{download_budget:{begin:async()=>{if(phase==='begin')throw error;},remaining:()=>100,consume:async()=>{if(phase==='consume')throw error;}}})).rejects.toBe(error);
 expect(requests).toBe(phase==='begin'?0:1);expect(f.close).toHaveBeenCalledOnce();
});
it('a late accounting failure overrides an already-received browser success only after all accounting has drained',async()=>{
 const f=childFixture(),error=new Error('checkpoint_response_unknown');let release!:()=>void,entered!:()=>void,returned=false;const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const gateway=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],async()=>({status:200,headers:{'content-type':'text/plain'},body:Buffer.from('abc')}));
 f.child.stdin.on('data',chunk=>{if(JSON.parse(chunk.toString()).type==='init')f.child.stdout.write(JSON.stringify({type:'request',id:1,url:'https://example.org/resource'})+'\n');});
 const read=readBrowser(gateway,'https://example.org/a',Date.now()+10000,{download_budget:{begin:async()=>{},remaining:()=>100,consume:async()=>{entered();await barrier;throw error;}}}).then(value=>{returned=true;return value;},failure=>{returned=true;throw failure;});
 const assertion=expect(read).rejects.toBe(error);await started;f.child.stdout.write(JSON.stringify({type:'result',url:'https://example.org/a',html:'<html><main><p>Reported before host checkpoint completed.</p></main></html>'})+'\n');await new Promise(resolve=>setTimeout(resolve,10));expect(returned).toBe(false);release();await assertion;expect(f.close).toHaveBeenCalledOnce();
});

import {it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
const native=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('node:https',()=>({request:native.request}));
import {UrlGateway,type GatewayDownloadBudget} from '../../src/tools/fetch.js';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();native.request.mockReset();});

// The actual nativeTransport state machine consumes mocked Node response events.
// These are stream/persistence-order unit assertions, never live socket evidence.
function responseFixture(parts:string[],failure?:string){
 const response=Object.assign(new EventEmitter(),{statusCode:200,headers:{'content-type':'text/plain'},pause:vi.fn(),resume:vi.fn(),destroy:vi.fn()});
 const request=Object.assign(new EventEmitter(),{destroy:vi.fn(),setTimeout:vi.fn(),end:vi.fn()});let index=0;
 const next=()=>{if(index<parts.length){response.emit('data',Buffer.from(parts[index++]!));if(failure)request.emit('error',new Error(failure));}else response.emit('end');};
 response.resume.mockImplementation(()=>{queueMicrotask(next);return response;});
 native.request.mockImplementation((_url,_options,callback)=>{request.end.mockImplementation(()=>queueMicrotask(()=>{callback(response);next();}));return request;});
 return {request,response};
}
const gateway=()=>new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}]);
it('native payload chunks wait for host accounting, include the final chunk once and admit only one logical resource',async()=>{
 const f=responseFixture(['abc','defg']);let begins=0,bytes=0;const observations:number[]=[];
 const result=await gateway().read('https://example.org/a',{download:{begin:async()=>{begins++;},remaining:()=>100-bytes,consume:async count=>{await new Promise(resolve=>setTimeout(resolve,1));bytes+=count;observations.push(count);}}});
 expect(Buffer.from(result.bytes).toString()).toBe('abcdefg');expect(observations).toEqual([3,4]);expect(bytes).toBe(7);expect(begins).toBe(1);expect(f.response.pause).toHaveBeenCalledTimes(2);expect(f.response.destroy).not.toHaveBeenCalled();
});
it('native response failure waits for an already-started accounting checkpoint before exposing the network error',async()=>{
 const f=responseFixture(['abc'],'wire_closed');let release!:()=>void,bytes=0,returned=false;const barrier=new Promise<void>(resolve=>{release=resolve;});
 const result=gateway().read('https://example.org/a',{download:{begin:async()=>{},remaining:()=>100,consume:async count=>{await barrier;bytes+=count;}}}).catch(error=>{returned=true;return error;});
 await new Promise(resolve=>setTimeout(resolve,10));expect(returned).toBe(false);expect(bytes).toBe(0);release();expect((await result).message).toBe('wire_closed');expect(bytes).toBe(3);expect(f.request.destroy).toHaveBeenCalled();expect(f.response.resume).not.toHaveBeenCalled();
});
it('an observed oversized native chunk remains accounted and destroys the request before additional payload delivery',async()=>{
 const f=responseFixture(['abcdefg','never']);let bytes=0;const download:GatewayDownloadBudget={begin:async()=>{},remaining:()=>Math.max(0,5-bytes),consume:async count=>{bytes+=count;if(bytes>5)throw new Error('batch_yield');}};
 await expect(gateway().read('https://example.org/a',{download})).rejects.toThrow('batch_yield');expect(bytes).toBe(7);expect(f.request.destroy).toHaveBeenCalled();expect(f.response.resume).not.toHaveBeenCalled();
});

it('host checkpoint backpressure does not spend the cumulative native network timeout',async()=>{
 vi.useFakeTimers();const f=responseFixture(['abc']);let bytes=0;
 const transport=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],undefined,{max_bytes:100,timeout_ms:20,max_redirects:5});
 const result=transport.read('https://example.org/a',{deadline:Date.now()+500,download:{begin:async()=>{},remaining:()=>100,consume:async count=>{await new Promise(resolve=>setTimeout(resolve,100));bytes+=count;}}});
 await vi.advanceTimersByTimeAsync(100);expect(Buffer.from((await result).bytes).toString()).toBe('abc');expect(bytes).toBe(3);expect(f.request.destroy).not.toHaveBeenCalled();
});
it('absolute project deadline still expires during host accounting and joins the observed-byte checkpoint',async()=>{
 vi.useFakeTimers();const f=responseFixture(['abc']);let bytes=0,returned=false;
 const result=gateway().read('https://example.org/a',{deadline:Date.now()+30,download:{begin:async()=>{},remaining:()=>100,consume:async count=>{await new Promise(resolve=>setTimeout(resolve,100));bytes+=count;}}}).catch(error=>{returned=true;return error;});
 await vi.advanceTimersByTimeAsync(30);expect(returned).toBe(false);expect(bytes).toBe(0);expect(f.request.destroy).toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(70);expect((await result).message).toBe('run_deadline');expect(bytes).toBe(3);expect(f.response.resume).not.toHaveBeenCalled();
});
it('network waiting across chunks spends one cumulative budget rather than restarting it',async()=>{
 vi.useFakeTimers();const f=responseFixture(['abc','def']);const resume=f.response.resume.getMockImplementation()!;
 f.response.resume.mockImplementation(()=>{setTimeout(()=>resume(),12);return f.response;});let bytes=0;
 const transport=new UrlGateway(async()=>{},async()=>[{address:'8.8.8.8',family:4}],undefined,{max_bytes:100,timeout_ms:20,max_redirects:5});
 const result=transport.read('https://example.org/a',{download:{begin:async()=>{},remaining:()=>100,consume:async count=>{await new Promise(resolve=>setTimeout(resolve,50));bytes+=count;}}}).catch(error=>error);
 await vi.advanceTimersByTimeAsync(120);expect((await result).message).toBe('source_timeout');expect(bytes).toBe(6);expect(f.request.destroy).toHaveBeenCalled();
});

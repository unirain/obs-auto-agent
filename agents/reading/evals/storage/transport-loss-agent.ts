import {Agent, type RequestOptions} from 'node:https';
import type {ClientRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {TLSSocket} from 'node:tls';

export type TransportLossTrace={schema_version:1;target_put_requests:number;response_events:number;suppressed_bytes:number;remote_status:number|null;request_id_sha256:string|null;tls_authorized:boolean;socket_destroyed:boolean};
/** Test host only. Intercepts decrypted TLS data before Node's HTTP parser receives it.
 * No proxy, endpoint rewrite, TLS bypass, SDK result replacement or adapter throw.
 * Agent.addRequest is verified against the pinned Node24 native _http_agent source;
 * node typings omit that internal method, so the bridge below is explicit. */
export class TransportLossAgent extends Agent {
 readonly trace:TransportLossTrace={schema_version:1,target_put_requests:0,response_events:0,suppressed_bytes:0,remote_status:null,request_id_sha256:null,tls_authorized:false,socket_destroyed:false};
 private target:string|null=null;
 constructor(readonly fixed_host:string,ca?:string){super({keepAlive:false,maxSockets:1,rejectUnauthorized:true,...(ca?{ca}:{})});}
 arm(path:string):void{if(this.target!==null||!path.startsWith('/')||path.includes('?')||this.trace.target_put_requests)throw new Error('transport_fault_arm_invalid');this.target=path;}
 addRequest(request:ClientRequest,options:RequestOptions):void{
  const host=options.hostname??options.host;
  if(host!==this.fixed_host)throw new Error('transport_fault_host_mismatch');
  if(request.method==='PUT'&&request.path===this.target){
   if(request.getHeader('expect'))throw new Error('transport_fault_expect_not_supported');
   this.trace.target_put_requests++;
   if(!this.trace.socket_destroyed){
    request.on('response',()=>{this.trace.response_events++;});
    request.once('socket',socket=>{
     if(!(socket instanceof TLSSocket))throw new Error('transport_fault_requires_tls');
     const emit=socket.emit;let pending:Buffer[]=[];let intercepting=true;
     socket.emit=((event:string|symbol,...args:unknown[]):boolean=>{
      if(event!=='data'||!intercepting)return Reflect.apply(emit,socket,[event,...args]) as boolean;
      if(!Buffer.isBuffer(args[0]))throw new Error('transport_fault_requires_bytes');
      pending.push(args[0]);const bytes=Buffer.concat(pending);if(bytes.length>16384){socket.destroy(new Error('transport_fault_status_invalid'));return true;}const end=bytes.indexOf('\r\n\r\n');
      if(end<0)return true;
      const status=/^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(bytes.subarray(0,end).toString('ascii'));
      if(status?.[1]!=='200'){
       intercepting=false;for(const chunk of pending)Reflect.apply(emit,socket,['data',chunk]);pending=[];return true;
      }
      const requestId=/^x-oss-request-id:[ \t]*([^\r\n]+)/im.exec(bytes.subarray(0,end).toString('ascii'))?.[1]?.trim();
      if(!requestId){socket.destroy(new Error('transport_fault_request_id_missing'));return true;}
      this.trace.request_id_sha256=createHash('sha256').update(requestId).digest('hex');this.trace.remote_status=200;this.trace.tls_authorized=socket.authorized;
      this.trace.suppressed_bytes+=bytes.length;pending=[];this.trace.socket_destroyed=true;
      // Keep suppressing any further chunks. The parser never sees the 200 header.
      queueMicrotask(()=>socket.destroy(Object.assign(new Error('injected_transport_loss'),{code:'ECONNRESET'})));
      return true;
     }) as typeof socket.emit;
    });
   }
  }
  const native=(Agent.prototype as unknown as {addRequest:(request:ClientRequest,options:RequestOptions)=>void}).addRequest;
  native.call(this,request,options);
 }
}

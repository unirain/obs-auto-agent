import {it,expect} from 'vitest';
import {createServer,request,Agent} from 'node:https';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TransportLossAgent} from './transport-loss-agent.js';
const exec=promisify(execFile);
it('drops an authenticated TLS success before HTTP response delivery; cold read reconciles persistent bytes and a retry cannot overwrite them',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reading-tls-loss-'));let writes=0;
 const config='[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n';
 await writeFile(join(root,'tls.conf'),config);await mkdir(join(root,'remote'));
 await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',join(root,'tls.conf'),'-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:15000});
 const cert=await readFile(join(root,'cert.pem'),'utf8');const key=await readFile(join(root,'key.pem'));
 const server=createServer({key,cert},async(req,res)=>{
  res.setHeader('x-oss-request-id','fixed-local-tls-fixture');
  if(req.url!=='/commits/00000000000000000001.json'){res.writeHead(404).end();return;}
  const target=join(root,'remote','commit.json');
  if(req.method==='PUT'){
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   try{await writeFile(target,Buffer.concat(chunks),{flag:'wx'});writes++;res.writeHead(200).end();}
   catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;res.writeHead(409).end();}
  }else if(req.method==='GET'){res.writeHead(200).end(await readFile(target));}else res.writeHead(405).end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 const loss=new TransportLossAgent('127.0.0.1',cert),fresh=new Agent({ca:cert,rejectUnauthorized:true,keepAlive:false});
 const send=(method:string,agent:Agent,body?:string)=>new Promise<{status:number;body:string}>((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path:'/commits/00000000000000000001.json',method,agent},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>resolve({status:res.statusCode!,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);
 });
 try{
  loss.arm('/commits/00000000000000000001.json');
  await expect(send('PUT',loss,'immutable original')).rejects.toMatchObject({code:'ECONNRESET'});
  expect(loss.trace).toMatchObject({target_put_requests:1,response_events:0,remote_status:200,tls_authorized:true,socket_destroyed:true});expect(loss.trace.suppressed_bytes).toBeGreaterThan(0);expect(loss.trace.request_id_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(writes).toBe(1);expect(await readFile(join(root,'remote','commit.json'),'utf8')).toBe('immutable original');
  expect(await send('GET',fresh)).toEqual({status:200,body:'immutable original'});
  expect(await send('PUT',fresh,'different stale input')).toMatchObject({status:409});expect(writes).toBe(1);
  const untrusted=new TransportLossAgent('127.0.0.1');untrusted.arm('/commits/00000000000000000001.json');
  try{await expect(send('PUT',untrusted,'untrusted TLS')).rejects.toBeDefined();expect(untrusted.trace.socket_destroyed).toBe(false);expect(untrusted.trace.remote_status).toBeNull();expect(writes).toBe(1);}finally{untrusted.destroy();}
 }finally{loss.destroy();fresh.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},30000);

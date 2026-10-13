import {createInterface} from 'node:readline';
import {extractWebSnapshot,type UrlGateway,type WebSnapshot} from './fetch.js';
import {SandboxRunner} from './sandbox.js';
/** Chromium has no network or host filesystem access. Requests cross a typed stdio gateway and return validated bytes. */
export async function readBrowser(gateway:UrlGateway,url:string,deadline:number):Promise<WebSnapshot>{
  const session=await new SandboxRunner().spawn('node',['/opt/reading/dist/agents/reading/src/tools/browser-worker.js'],deadline);const lines=createInterface({input:session.child.stdout});let stderr='';session.child.stderr.on('data',(bytes:Buffer)=>{if(stderr.length<2000)stderr+=bytes.toString();});
  const output=new Promise<WebSnapshot>((resolve,reject)=>{session.child.on('error',reject);session.child.on('exit',code=>reject(new Error(`browser_worker_exit:${code}:${stderr}`)));
    lines.on('line',line=>{if(line.length>20_000_000){reject(new Error('browser_response_size'));return;}let message:Record<string,unknown>;try{message=JSON.parse(line) as Record<string,unknown>;}catch{reject(new Error('browser_protocol_invalid'));return;}
      if(message.type==='request'&&typeof message.id==='number'&&typeof message.url==='string'){
        const id=message.id;void gateway.read(message.url,{deadline,mime:['text/html','text/plain','text/css','application/javascript','text/javascript','application/json','image/png','image/jpeg','image/webp','image/svg+xml','font/woff','font/woff2','application/font-woff','application/octet-stream']})
          .then(response=>session.child.stdin.write(`${JSON.stringify({type:'reply',id,mime:response.content_type,body:Buffer.from(response.bytes).toString('base64')})}\n`))
          .catch(error=>session.child.stdin.write(`${JSON.stringify({type:'reply',id,error:error instanceof Error?error.message:'gateway_failed'})}\n`));
      }else if(message.type==='result'&&typeof message.url==='string'&&typeof message.html==='string')resolve(extractWebSnapshot(message.url,message.html,new Date().toISOString()));
      else if(message.type==='error')reject(new Error(String(message.error)));else reject(new Error('browser_protocol_invalid'));
    });
  });session.child.stdin.write(`${JSON.stringify({type:'init',url,deadline})}\n`);
  try{return await output;}finally{lines.close();await session.close();}
}

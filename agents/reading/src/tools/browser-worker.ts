import {createInterface} from 'node:readline';
import {chromium,type Browser} from 'playwright';
const input=createInterface({input:process.stdin});let nextId=0;const pending=new Map<number,{resolve:(value:{mime:string;body:string})=>void;reject:(error:Error)=>void}>();let browser:Browser|null=null;let started=false;
const send=(value:unknown)=>process.stdout.write(`${JSON.stringify(value)}\n`);
function request(url:string):Promise<{mime:string;body:string}>{const id=++nextId;send({type:'request',id,url});return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}
input.on('line',line=>{let value:Record<string,unknown>;try{value=JSON.parse(line) as Record<string,unknown>;}catch{process.exit(2);return;}
  if(value.type==='reply'&&typeof value.id==='number'){const resolver=pending.get(value.id);if(!resolver)return;pending.delete(value.id);if(value.error)resolver.reject(new Error(String(value.error)));else resolver.resolve({mime:String(value.mime),body:String(value.body)});return;}
  if(started||value.type!=='init'||typeof value.url!=='string'||typeof value.deadline!=='number'){process.exit(2);return;}started=true;const deadline=value.deadline,url=value.url;
  const stop=setTimeout(()=>{send({type:'error',error:'run_deadline'});void browser?.close();process.exit(3);},Math.max(1,deadline-Date.now()));
  void(async()=>{try{browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-sandbox','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:'/tmp/browser-home'}});
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/*',async route=>{if(route.request().method()!=='GET'){await route.abort();return;}try{const response=await request(route.request().url());await route.fulfill({status:200,contentType:response.mime,body:Buffer.from(response.body,'base64')});}catch{await route.abort();}});
    const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:Math.max(1,deadline-Date.now())});await page.waitForLoadState('networkidle',{timeout:Math.min(3000,Math.max(1,deadline-Date.now()))}).catch(()=>{});
    send({type:'result',url:page.url(),html:await page.content()});
  }catch(error){send({type:'error',error:error instanceof Error?error.message:'browser_failed'});}finally{clearTimeout(stop);await browser?.close();input.close();process.exit(0);}})();
});
input.on('close',()=>{if(!started)process.exit(2);});

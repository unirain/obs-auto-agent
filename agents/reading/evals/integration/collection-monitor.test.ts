import {it,expect} from 'vitest';
import {collectionFixture,langchainPage,claudeFeed} from './collection-fixture.js';
import {WebSourceAdapter} from '../../src/collect/sources.js';
import {IssueProjector,decodeMetadata,type IssuePort,type IssueFact} from '../../src/monitor/issues.js';
import {Watchdog} from '../../src/monitor/main.js';
class LocalIssues implements IssuePort{
 issues:IssueFact[]=[];notices:string[]=[];writes=0;
 async list(){return structuredClone(this.issues);}
 async create(_title:string,body:string){this.writes++;const issue={number:this.issues.length+1,body,state:'open' as const};this.issues.push(issue);return structuredClone(issue);}
 async update(number:number,body:string,state:'open'|'closed'){this.writes++;Object.assign(this.issues.find(issue=>issue.number===number)!,{body,state});}
 async comments(){return [...this.notices];}
 async comment(_number:number,body:string){this.writes++;this.notices.push(body);}
}
it('a successful source fetch whose page checkpoint fails cannot close the source Issue; only cold committed recovery closes it',async()=>{
 const f=await collectionFixture();try{
  let healthy=false;const first=()=>new WebSourceAdapter({source_id:'langchain_blog',entry_url:'https://www.langchain.com/blog',enabled:true,window_days:7,batch_size:50},async url=>{if(!healthy)throw new Error('source_http_503');return {url,body:langchainPage(1)};});
  const second=()=>new WebSourceAdapter({source_id:'claude_resources',entry_url:'https://claude.com/resources',enabled:true,window_days:7,batch_size:50},async url=>({url,body:claudeFeed()}));
  const initial=await f.session([first(),second()],true);expect((await initial.run()).outcome).toBe('partial');
  const issues=new LocalIssues(),watchdog=new Watchdog(new IssueProjector(issues,async()=>{}),async()=>(await f.monitor()).events,async()=>({global:false,disabled_sources:[]}));
  await watchdog.run();const issue=issues.issues.find(issue=>decodeMetadata(issue.body)?.source_id==='langchain_blog')!;
  expect(issue.state).toBe('open');const sourcePosition=decodeMetadata(issue.body)!.last_position;
  healthy=true;const interrupted=await f.session([first(),second()]),commit=interrupted.journal.commitMany.bind(interrupted.journal);let fail=true;
  interrupted.journal.commitMany=async(...args)=>{if(args[1]==='source_page_and_candidates'&&fail){fail=false;f.store.faults.push({operation:'create',kind:'permission'});}return commit(...args);};
  await expect(interrupted.run()).rejects.toThrow();
  const events=(await f.monitor()).events;expect(events.some(event=>event.source_id==='langchain_blog'&&event.kind==='recovered')).toBe(false);
  const sourceBefore=structuredClone(issue),noticesBefore=issues.notices.length,storeWrites=f.store.calls.filter(call=>['create','delete'].includes(call.operation)).length;
  await watchdog.run();expect(issue).toEqual(sourceBefore);expect(issue.state).toBe('open');expect(decodeMetadata(issue.body)!.last_position).toBe(sourcePosition);expect(issues.notices).toHaveLength(noticesBefore);
  expect(f.store.calls.filter(call=>['create','delete'].includes(call.operation))).toHaveLength(storeWrites);
  const cold=await f.session([first(),second()]);await cold.run();expect((await f.monitor()).events.some(event=>event.source_id==='langchain_blog'&&event.kind==='recovered')).toBe(true);
  await watchdog.run();expect(issue.state).toBe('closed');expect(decodeMetadata(issue.body)!.status).toBe('recovered');expect(decodeMetadata(issue.body)!.last_position).toBeGreaterThan(sourcePosition);
  expect(f.queries()).toBe(0);
 }finally{await f.cleanup();}
});

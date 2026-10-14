import {it,expect} from 'vitest';
import {collectionFixture,langchainPage,claudeFeed} from './collection-fixture.js';
import {WebSourceAdapter} from '../../src/collect/sources.js';
import {IssueProjector,decodeMetadata,type IssuePort,type IssueFact} from '../../src/monitor/issues.js';
import {Watchdog,runWatchdog} from '../../src/monitor/main.js';
import type {Octokit} from '@octokit/rest';
import {parseDispatch} from '../../src/config/dispatch.js';
import type {SourceHealth} from '../../src/collect/incidents.js';
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
it.each(['disabled','not_attempted','publish-only','other_source','global_pause'])('existing source failure survives %s and another source success; policy suppression never becomes recovery',async mode=>{
 const f=await collectionFixture();try{
  const failed=()=>new WebSourceAdapter({source_id:'langchain_blog',entry_url:'https://www.langchain.com/blog',enabled:mode!=='disabled',window_days:7,batch_size:50},async()=>{throw new Error(mode==='not_attempted'?'domain_denied:www.langchain.com':mode==='global_pause'?'global_paused':'source_http_503');}),good=()=>new WebSourceAdapter({source_id:'claude_resources',entry_url:'https://claude.com/resources',enabled:true,window_days:7,batch_size:50},async url=>{if(mode==='global_pause'&&paused)throw new Error('global_paused');return {url,body:claudeFeed()};});
  let paused=false;const initialFailure=new WebSourceAdapter({...failed().config,enabled:true},async()=>{throw new Error('source_http_503');}),first=await f.session([initialFailure,good()],true);await first.run();const oldHealth=(await first.journal.load<SourceHealth>('sources/health'))!;
  const issues=new LocalIssues();let suppress=false;const watchdog=new Watchdog(new IssueProjector(issues,async()=>{}),async()=>(await f.monitor()).events,async()=>({global:mode==='global_pause'&&suppress,disabled_sources:mode==='disabled'&&suppress?['langchain_blog']:[]}));await watchdog.run();const issue=issues.issues.find(value=>decodeMetadata(value.body)?.source_id==='langchain_blog')!;expect(issue.state).toBe('open');
  const next=await f.session(mode==='other_source'||mode==='publish-only'?[good()]:[failed(),good()]);if(mode==='global_pause'){paused=true;(await next.ports.gate.current()).paused=true;}suppress=true;
  if(mode==='publish-only')await next.controller.run(parseDispatch({mode:'publish-only',project_id:next.journal.keys('projects/')[0]!.slice(9)}),'owner');else await next.run();
  const cold=await f.session([]),health=(await cold.journal.load<SourceHealth>('sources/health'))!;expect(health.events.slice(0,oldHealth.events.length)).toEqual(oldHealth.events);expect(health.active['langchain_blog:source_http_503']).toBeDefined();expect(health.events.some(event=>event.source_id==='langchain_blog'&&event.kind==='recovered')).toBe(false);
  await watchdog.run();expect(issue.state).toBe('open');expect(decodeMetadata(issue.body)).toMatchObject({status:'active',suppressed:mode==='disabled'||mode==='global_pause'});if(mode==='disabled'||mode==='global_pause')expect(issue.body).toContain('策略抑制');const notices=issues.notices.length;await watchdog.run();expect(issues.notices).toHaveLength(notices);expect(f.queries()).toBe(0);
 }finally{await f.cleanup();}
});
it('Actions and Issue API outage cannot report healthy or deliver a notification; recovery resumes persistent alerts without repeated notices',async()=>{
 const f=await collectionFixture();try{
  const failed=new WebSourceAdapter({source_id:'langchain_blog',entry_url:'https://www.langchain.com/blog',enabled:true,window_days:7,batch_size:50},async()=>{throw new Error('source_http_503');}),first=await f.session([failed],true);await first.run();
  const issues=new LocalIssues();let offline=true,actionsReads=0,issueReads=0;const list=issues.list.bind(issues);issues.list=async()=>{issueReads++;if(offline)throw new Error('issue_api_unavailable');return list();};
  const actions={actions:{listWorkflowRuns:()=>{}},paginate:async()=>{actionsReads++;if(offline)throw new Error('actions_api_unavailable');return [];}} as unknown as Octokit;
  const options={actions,repository:'test/implementation',workspace_id:first.journal.handle.workspace_id,projector:new IssueProjector(issues,async()=>{}),readPolicy:async()=>({global:false,disabled_sources:[],enabled_at:null}),readReportRunIds:async()=>(await f.monitor()).reportIds,readEvents:async()=>(await f.monitor()).events};
  const revision=first.journal.handle.revision;await expect(runWatchdog(options)).rejects.toThrow('issue_api_unavailable');expect(actionsReads).toBe(1);expect(issueReads).toBe(1);expect(issues.issues).toEqual([]);expect(issues.notices).toEqual([]);expect(issues.writes).toBe(0);expect(first.journal.handle.revision).toBe(revision);
  offline=false;await runWatchdog(options);expect(issues.issues.find(value=>decodeMetadata(value.body)?.source_id==='langchain_blog')?.state).toBe('open');const notices=issues.notices.length;await runWatchdog(options);expect(issues.notices).toHaveLength(notices);expect(f.queries()).toBe(0);
 }finally{await f.cleanup();}
});

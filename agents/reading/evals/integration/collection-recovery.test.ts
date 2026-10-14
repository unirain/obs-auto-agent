import {it,expect} from 'vitest';
import {rm} from 'node:fs/promises';
import {collectionFixture,langchainPage,claudeFeed} from './collection-fixture.js';
import {WebSourceAdapter,emptySourceProgress,type SourceCursor} from '../../src/collect/sources.js';
import type {IdentityState} from '../../src/collect/identity.js';
import type {SourceHealth} from '../../src/collect/incidents.js';
const config={source_id:'langchain_blog' as const,entry_url:'https://www.langchain.com/blog',enabled:true,window_days:7,batch_size:50};
it.each(['before_commit','reply_lost'] as const)('source page %s keeps candidates and cursor in one version and cold recovery completes more than fifty without duplicates',async fault=>{
 const f=await collectionFixture();try{
  const visits:string[]=[],adapter=()=>new WebSourceAdapter(config,async url=>{visits.push(url);return {url,body:langchainPage(new URL(url).search?6:55,new URL(url).search?55:0,!new URL(url).search)};});
  const first=await f.session([adapter()],true),commit=first.journal.commitMany.bind(first.journal);let injected=false;
  first.journal.commitMany=async(...args)=>{if(args[1]==='source_page_and_candidates'&&!injected){injected=true;if(fault==='before_commit')f.store.faults.push({operation:'create',kind:'permission'});await commit(...args);throw new Error('source_page_reply_lost');}return commit(...args);};
  await expect(first.run()).rejects.toThrow();await rm(first.local,{recursive:true,force:true});
  const cold=await f.session([adapter()]),identity=await cold.journal.load<IdentityState>('identity'),bookmark=await f.progress(cold.journal,'langchain_blog');
  if(fault==='before_commit'){expect(identity?.candidates??{}).toEqual({});expect(bookmark).toEqual(emptySourceProgress());}else{expect(Object.keys(identity!.candidates)).toHaveLength(50);expect(bookmark.active?.offset).toBe(50);expect(bookmark.observed_ids).toHaveLength(50);}
  visits.length=0;const report=await cold.run(),complete=(await cold.journal.load<IdentityState>('identity'))!;
  expect(Object.keys(complete.candidates)).toHaveLength(61);expect(new Set(Object.values(complete.candidates).map(item=>item.url)).size).toBe(61);
  expect((await f.progress(cold.journal,'langchain_blog')).active).toBeNull();expect((await f.progress(cold.journal,'langchain_blog')).observed_ids).toHaveLength(61);
  expect(visits).toHaveLength(fault==='before_commit'?3:2);expect(report.source_results).toMatchObject([{source_id:'langchain_blog',status:'success',cursor_after:null}]);
  expect(f.selected).toHaveLength(61);expect(f.queries()).toBe(0);expect(cold.journal.keys('invocations/')).toEqual([]);
  const last=await f.session([adapter()]);await last.run();expect(f.selected).toHaveLength(61);expect(Object.keys((await last.journal.load<IdentityState>('identity'))!.candidates)).toHaveLength(61);
 }finally{await f.cleanup();}
},60000);
it('one failing source retains its active cursor while another source candidates continue, with a partial report and cold durable incident',async()=>{
 const f=await collectionFixture();try{
  const first=new WebSourceAdapter(config,async()=>{throw new Error('source_http_503');}),second=new WebSourceAdapter({...config,source_id:'claude_resources',entry_url:'https://claude.com/resources'},async url=>({url,body:claudeFeed(3)}));
  const session=await f.session([first,second],true),cursor:SourceCursor={page_url:config.entry_url+'?page=2',offset:0,page_hash:null,seen_pages:[config.entry_url],window_start:'2026-10-01T00:00:00Z',started_at:'2026-10-14T00:00:00Z'},saved={...emptySourceProgress(),active:cursor};
  await session.journal.commitMany({'sources/langchain_blog/progress':saved},'source_incidents_reconciled');
  const report=await session.run();expect(report.outcome).toBe('partial');expect(report.source_results.map(result=>[result.source_id,result.status])).toEqual([['langchain_blog','failed'],['claude_resources','success']]);
  expect(f.selected).toHaveLength(3);expect(f.queries()).toBe(0);await rm(session.local,{recursive:true,force:true});
  const cold=await f.session([]);expect(await f.progress(cold.journal,'langchain_blog')).toEqual(saved);expect((await f.progress(cold.journal,'claude_resources')).active).toBeNull();
  const health=(await cold.journal.load<SourceHealth>('sources/health'))!;expect(health.active['langchain_blog:source_http_503']).toBeDefined();expect(health.events.some(event=>event.source_id==='claude_resources'&&event.kind==='recovered')).toBe(false);
  expect(await cold.journal.load('runs/'+report.run_id)).toMatchObject({outcome:'partial',source_results:report.source_results});
 }finally{await f.cleanup();}
});
it.each(['disabled','not_attempted'] as const)('an active cursor whose source becomes %s stops the page loop immediately and lets the next source run',async status=>{
 const f=await collectionFixture();try{
  let reads=0,collections=0;
  const stopped=new WebSourceAdapter({...config,enabled:status!=='disabled'},async()=>{reads++;throw new Error('domain_denied:www.langchain.com');}),collect=stopped.collect.bind(stopped);
  stopped.collect=async(...args)=>{if(++collections>1)throw new Error('repeated_suppressed_cursor');return collect(...args);};
  const good=new WebSourceAdapter({...config,source_id:'claude_resources',entry_url:'https://claude.com/resources'},async url=>({url,body:claudeFeed()}));
  const session=await f.session([stopped,good],true),saved={...emptySourceProgress(),active:{page_url:config.entry_url,offset:0,page_hash:null,seen_pages:[],window_start:'2026-10-01T00:00:00Z',started_at:'2026-10-14T00:00:00Z'}};
  await session.journal.commitMany({'sources/langchain_blog/progress':saved},'source_incidents_reconciled');
  const report=await session.run();expect(collections).toBe(1);expect(reads).toBe(status==='disabled'?0:1);expect(report.source_results.map(result=>result.status)).toEqual([status,'success']);expect(f.selected).toHaveLength(1);
  const cold=await f.session([]);expect(await f.progress(cold.journal,'langchain_blog')).toEqual(saved);expect((await cold.journal.load<SourceHealth>('sources/health'))!.events).toEqual([]);
 }finally{await f.cleanup();}
});

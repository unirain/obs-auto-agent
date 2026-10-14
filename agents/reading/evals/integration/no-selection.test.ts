import {it,expect} from 'vitest';
import {collectionFixture,claudeFeed} from './collection-fixture.js';
import {WebSourceAdapter} from '../../src/collect/sources.js';
import type {IdentityState} from '../../src/collect/identity.js';
it.each([0,2])('scheduled two-source completion with %s candidates per source records zero selection and never creates an empty PR',async count=>{
 const f=await collectionFixture();try{
  const sources=()=>[new WebSourceAdapter({source_id:'langchain_blog',entry_url:'https://www.langchain.com/blog',enabled:true,window_days:7,batch_size:50},async url=>({url,body:claudeFeed(count).replaceAll('https://claude.com/resources/articles/','https://www.langchain.com/blog/')})),new WebSourceAdapter({source_id:'claude_resources',entry_url:'https://claude.com/resources',enabled:true,window_days:7,batch_size:50},async url=>({url,body:claudeFeed(count)}))];
  const first=await f.session(sources(),true),report=await first.run();expect(report.outcome).toBe('success_no_selection');expect(report.source_results.map(result=>result.status)).toEqual(['success','success']);expect(report.delivery_results.every(result=>result.state==='skipped')).toBe(true);expect(report.usage.invocation_count).toBe(0);expect(f.queries()).toBe(0);expect(first.journal.keys('delivery-')).toEqual([]);
  const cold=await f.session(sources());expect(await cold.journal.load('runs/'+report.run_id)).toMatchObject({outcome:'success_no_selection',delivery_results:report.delivery_results});expect(Object.keys((await cold.journal.load<IdentityState>('identity'))?.candidates??{})).toHaveLength(count*2);
  const repeat=await cold.run();expect(repeat.outcome).toBe('success_no_selection');expect(f.selected).toHaveLength(count*2);expect(cold.journal.keys('delivery-')).toEqual([]);expect(cold.journal.handle.snapshot.manifest.files.some(file=>file.path.includes('/draft/'))).toBe(false);
 }finally{await f.cleanup();}
});

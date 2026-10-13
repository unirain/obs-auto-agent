import * as cheerio from 'cheerio';
import {digest} from '../stages/contracts.js';
import {discoverCandidate,normalizeUrl,type IdentityState,addCandidate} from './identity.js';
export type SourceConfig={source_id:'langchain_blog'|'claude_resources';entry_url:string;enabled:boolean;window_days:number;batch_size:number;retention_days?:number;overlap_hours?:number};
export type SourceCursor={page_url:string;offset:number;page_hash:string|null;seen_pages:string[];window_start:string;started_at:string};
export type SourceProgress={schema_version:1;active:SourceCursor|null;last_complete_watermark:string|null;watermark_ids:string[];observed_ids:string[];last_success_at:string|null};
export const emptySourceProgress=():SourceProgress=>({schema_version:1,active:null,last_complete_watermark:null,watermark_ids:[],observed_ids:[],last_success_at:null});
export type SourceResult={source_id:string;status:'success'|'failed'|'partial'|'disabled'|'not_attempted';reason_code:string|null;attempted_at:string|null;last_success_at:string|null;
  cursor_before:SourceCursor|null;cursor_after:SourceCursor|null;coverage:{from:string;to:string}|null;coverage_gap:{reason:string;from:string;to:string}|null;unsupported:string[]};
export type SourcePage={candidates:ReturnType<typeof discoverCandidate>[];observed_candidates?:ReturnType<typeof discoverCandidate>[];observed_ids?:string[];next:SourceCursor|null;result:SourceResult};
export type HtmlFetch=(url:string)=>Promise<{url:string;body:string}>;
function parsedDate(raw:string|undefined):string|null {if(!raw)return null;const natural=/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw.trim());const value=Date.parse(natural?`${natural[1]} ${natural[2]}, ${natural[3]} UTC`:raw);return Number.isFinite(value)?new Date(value).toISOString():null;}
export class WebSourceAdapter {
  constructor(readonly config:SourceConfig,private readonly fetch:HtmlFetch){}
  async collect(progress:SourceProgress,now:Date):Promise<SourcePage&{progress:SourceProgress}>{
    let cursor=progress.active;
    if(!cursor){const from=progress.last_complete_watermark?new Date(Date.parse(progress.last_complete_watermark)-(this.config.overlap_hours??24)*3600000).toISOString():new Date(now.getTime()-this.config.window_days*86400000).toISOString();
      cursor={page_url:this.config.entry_url,offset:0,page_hash:null,seen_pages:[],window_start:from,started_at:now.toISOString()};}
    const page=await this.page(cursor,now);const next=structuredClone(progress);
    if(['failed','disabled','not_attempted'].includes(page.result.status))return {...page,next:progress.active,result:{...page.result,cursor_before:progress.active,cursor_after:progress.active},progress:next};
    const previouslySeen=new Set(progress.observed_ids??[]);const firstWindow=new Date(cursor.window_start);firstWindow.setUTCHours(0,0,0,0);
    page.candidates=(page.observed_candidates??page.candidates).filter(candidate=>!previouslySeen.has(candidate.source_item_id)&&(!progress.last_complete_watermark?candidate.published_at===null||candidate.published_at>=firstWindow.toISOString():true));
    next.observed_ids=[...new Set([...(progress.observed_ids??[]),...(page.observed_ids??page.candidates.map(candidate=>candidate.source_item_id))])].sort();
    next.active=page.next;
    if(page.next===null){next.last_complete_watermark=cursor.started_at;next.last_success_at=now.toISOString();
      next.watermark_ids=page.candidates.filter(candidate=>candidate.published_at===next.last_complete_watermark).map(candidate=>candidate.source_item_id);
      if(this.config.retention_days&&progress.last_complete_watermark&&now.getTime()-Date.parse(progress.last_complete_watermark)>this.config.retention_days*86400000){
        page.result.status='partial';page.result.reason_code='coverage_gap';page.result.coverage_gap={reason:'source_retention_exceeded',from:progress.last_complete_watermark,to:new Date(now.getTime()-this.config.retention_days*86400000).toISOString()};}
      else if(this.config.source_id==='claude_resources'&&progress.last_complete_watermark){page.result.coverage_gap=null;page.result.reason_code=null;page.result.status='success';}
    }else{page.result.status='partial';page.result.reason_code='pagination_pending';page.result.last_success_at=null;}
    return {...page,progress:next};
  }
  async page(cursor:SourceCursor|null,now:Date):Promise<SourcePage>{
    const source_id=this.config.source_id;const started=now.toISOString();
    if(!this.config.enabled)return {candidates:[],next:cursor,result:{source_id,status:'disabled',reason_code:'policy_disabled',attempted_at:null,last_success_at:null,cursor_before:cursor,cursor_after:cursor,coverage:null,coverage_gap:null,unsupported:[]}};
    const current=cursor??{page_url:this.config.entry_url,offset:0,page_hash:null,seen_pages:[],window_start:new Date(now.getTime()-this.config.window_days*86400000).toISOString(),started_at:started};
    try{
      const response=await this.fetch(current.page_url);const $=cheerio.load(response.body);const rows=source_id==='langchain_blog'?$('.blog-list.is-normal .blog-item'):$("a[class*='ResourceCard'][href]");
      if(rows.length===0)throw new Error('source_parse_empty');
      const entries:{url:string;title:string|null;published:string|null;unsupported:boolean}[]=[];const seen=new Set<string>();
      rows.each((_,row)=>{const element=$(row);const href=source_id==='langchain_blog'?element.find('a.blog-link-absolute[href]').attr('href'):element.attr('href');if(!href)return;
        const url=normalizeUrl(new URL(href,response.url).href);if(seen.has(url))return;seen.add(url);
        const title=(element.find('h2,h3,h4').first().text()||element.find("[class*='title']").first().text()||element.text()).trim()||null;
        const date=element.find('time').attr('datetime')||element.find("[class*='date']").first().text();
        entries.push({url,title,published:parsedDate(date),unsupported:/\/resources\/(webinars|videos)\//.test(url)});
      });
      if(entries.length===0)throw new Error('source_parse_items_invalid');
      const hash=digest(JSON.stringify(entries));const offset=current.page_hash&&current.page_hash!==hash?0:current.offset;
      if(offset>entries.length)throw new Error('source_cursor_invalid');
      const chunk=entries.slice(offset,offset+this.config.batch_size);const observed_candidates=chunk.filter(item=>!item.unsupported).map(item=>discoverCandidate(source_id,item.url,item.title,item.published,started));
      const candidates=observed_candidates.filter(candidate=>candidate.published_at===null||candidate.published_at>=current.window_start);
      const nextHref=$('a.w-pagination-next[href],a[rel="next"][href]').first().attr('href');let next:SourceCursor|null=null;
      if(offset+chunk.length<entries.length)next={...current,offset:offset+chunk.length,page_hash:hash};
      else if(nextHref){const page_url=new URL(nextHref,response.url).href;
        if(new URL(page_url).origin!==new URL(this.config.entry_url).origin||current.seen_pages.includes(page_url)||page_url===current.page_url)throw new Error('pagination_loop_or_scope');
        next={...current,page_url,offset:0,page_hash:null,seen_pages:[...current.seen_pages,current.page_url]};}
      const coverage_gap=source_id==='claude_resources'&&!next?{reason:'source_no_history_pagination',from:current.window_start,to:started}:null;
      return {candidates,observed_candidates,observed_ids:chunk.map(item=>digest(item.url)),next,result:{source_id,status:coverage_gap?'partial':'success',reason_code:coverage_gap?.reason??null,attempted_at:started,last_success_at:started,
        cursor_before:cursor,cursor_after:next,coverage:{from:current.window_start,to:started},coverage_gap,unsupported:chunk.filter(item=>item.unsupported).map(item=>item.url)}};
    }catch(error){const reason=error instanceof Error?error.message:'source_read_failed';const suppressed=/global_paused|project_paused|source_disabled|policy_unavailable|domain_denied/.test(reason);return {candidates:[],next:cursor,result:{source_id,status:suppressed?(reason.includes('source_disabled')?'disabled':'not_attempted'):'failed',reason_code:reason,attempted_at:suppressed?null:started,last_success_at:null,
      cursor_before:cursor,cursor_after:cursor,coverage:null,coverage_gap:null,unsupported:[]}};}
  }
}
export async function commitSourcePage(state:IdentityState,page:SourcePage,commit:(next:IdentityState,cursor:SourceCursor|null,result:SourceResult)=>Promise<void>):Promise<void>{
  const next=structuredClone(state);for(const candidate of page.candidates)addCandidate(next,candidate);await commit(next,page.next,page.result);
}

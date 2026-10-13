import {parsePublicFeed,feedMaterial,requirePublicText} from './feed.js';
import * as cheerio from 'cheerio';
import {extractWebSnapshot,type WebSnapshot} from './fetch.js';

/** Explicit hydration shells only: ordinary short articles never trigger browser execution. */
export function requiresJavascript(html:string):boolean {
  const $=cheerio.load(html);const scripts=$('script[src],script').length;const marker=/enable javascript|javascript (?:is )?required|please turn on javascript|loading(?:\.{3}|…)/i.test($('body').text());
  $('script,style,nav,header,footer,noscript,form').remove();const main=$('article,main,[role="main"]').first();const text=(main.length?main:$('body')).text().trim();
  return scripts>0&&(text.length===0||(text.length<200&&marker));
}
export async function readWebMaterial(url:string,html:string,retrieved_at:string,browser:()=>Promise<WebSnapshot>):Promise<{snapshot:WebSnapshot;method:'http'|'browser'}>{
  const feed=parsePublicFeed(html,url);if(feed)return {snapshot:feedMaterial(feed,url,retrieved_at),method:'http'};
  if(requiresJavascript(html)){const snapshot=await browser();if(snapshot.text.trim().length<20||/^(loading(?:\.{3}|…)?|please enable javascript)$/i.test(snapshot.text.trim()))throw new Error('browser_article_unavailable');if(snapshot.url!==url)throw new Error('browser_navigation_changed_requires_refetch');return {snapshot,method:'browser'};}
  requirePublicText(url,html);return {snapshot:extractWebSnapshot(url,html,retrieved_at),method:'http'};
}

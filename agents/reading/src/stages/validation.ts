import {parse as parseYaml} from 'yaml';
import * as cheerio from 'cheerio';
import {digest,ReviewSchema,parseModel,type Evidence,type Review,type Scope} from './contracts.js';
import {safeRelative} from '../tools/files.js';
export type Claim={id:string;text:string;line:number;evidence_ids:string[];claim_type:Evidence['claim_type']};
export type FigurePlan={section:string;type:string;goal:string;resource_path:string|null;no_figure_reason:string|null};
export type NoteResource={path:string;hash:string;mime:string;source_path:string|null;caption:string;visual_check:'passed'|'failed'|'skipped';core:boolean;url:string|null};
export type Writing={note_path:string;markdown:string;claims:Claim[];figure_plan:FigurePlan[];resources:NoteResource[];degradations:string[]};
export function normalizeNotePath(markdown:string,date:string,fixed:string|null=null):string {
  if(fixed){safeRelative(fixed);if(!/^Organize Notes By AI\/\d{6}-[^<>:"/\\|?*\u0000-\u001f\u007f]+\.md$/.test(fixed))throw new Error('fixed_filename_invalid');return fixed;}
  const metadata=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);if(!metadata)throw new Error('frontmatter_missing');const values=parseYaml(metadata[1]!) as Record<string,unknown>;if(typeof values.title!=='string')throw new Error('note_title_unusable');
  const title=Array.from(values.title.normalize('NFC').replace(/[<>:"/\\|?*#\u0000-\u001f\u007f]/g,'').replace(/[ .]+$/,'').trim()).slice(0,20).join('');if(!title)throw new Error('note_title_unusable');
  return `Organize Notes By AI/${date.slice(2).replaceAll('-','')}-${title}.md`;
}
export function validateWriting(writing:Writing,evidence:Evidence[],scope:Scope,availableFiles:Record<string,Uint8Array>,finalResources=false,primarySourceUrls?:string[],allowedUrls?:string[]):void {
  safeRelative(writing.note_path);if(!writing.note_path.startsWith('Organize Notes By AI/')||!writing.note_path.endsWith('.md')||writing.note_path.slice('Organize Notes By AI/'.length).includes('/'))throw new Error('note_path_denied');
  const metadata=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(writing.markdown);if(!metadata)throw new Error('frontmatter_missing');
  const parsed=parseYaml(metadata[1]!) as Record<string,unknown>;if(!parsed||typeof parsed.title!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.created))||typeof parsed.source!=='string'||!/^https?:\/\//.test(parsed.source))throw new Error('frontmatter_invalid');
  if(primarySourceUrls&&!primarySourceUrls.includes(parsed.source))throw new Error('note_primary_source_mismatch');
  if(!/^Organize Notes By AI\/\d{6}-[^<>:"/\\|?*\u0000-\u001f\u007f]+\.md$/.test(writing.note_path)||!writing.note_path.startsWith(`Organize Notes By AI/${String(parsed.created).slice(2).replaceAll('-','')}-`))throw new Error('note_filename_invalid');
  if(!Array.isArray(parsed.tags)||parsed.tags.length<3||parsed.tags.length>8||parsed.tags.some(tag=>typeof tag!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)))throw new Error('tags_invalid');
  if(!/^# .+/m.test(writing.markdown)||!/> \[!abstract\]/.test(writing.markdown))throw new Error('title_or_abstract_missing');
  const stripped=writing.markdown.replace(/```[\s\S]*?```/g,'').replace(/`[^`]*`/g,'');
  if(/<(?:script|iframe|object|embed|style|form)\b|\bon[a-z]+\s*=|(?:javascript|data|vbscript)\s*:/i.test(stripped))throw new Error('active_content_denied');
  const tags=stripped.match(/<\/?(?:div|section|span|table|tbody|tr|td|th|p)\b[^>]*>/gi)??[];const stack:string[]=[];
  for(const tag of tags){const name=/^<\/?([a-z]+)/i.exec(tag)![1]!.toLowerCase();if(tag.startsWith('</')){if(stack.pop()!==name)throw new Error('html_unbalanced');}else if(!tag.endsWith('/>'))stack.push(name);}if(stack.length)throw new Error('html_unbalanced');
  const ids=new Map(evidence.map(item=>[item.evidence_id,item]));const lines=writing.markdown.split('\n');
  for(const claim of writing.claims){if(!claim.id||!Number.isInteger(claim.line)||claim.line<1||!lines[claim.line-1]?.includes(claim.text)||!claim.evidence_ids.length||claim.evidence_ids.some(id=>!ids.has(id)))throw new Error('claim_mapping_invalid');
    const facts=claim.evidence_ids.map(id=>ids.get(id)!);if(claim.claim_type==='code_observation'&&!facts.every(fact=>fact.claim_type==='code_observation'))throw new Error('source_report_misrepresented');
    if(claim.claim_type==='agent_inference'&&!/分析|推测|推断|inference|analysis/i.test(lines[claim.line-1]!))throw new Error('inference_not_disclosed');}
  if(!writing.claims.length)throw new Error('claims_missing');
  const headings=[...writing.markdown.matchAll(/^##\s+(.+)$/gm)];for(let index=0;index<headings.length;index++){const heading=headings[index]!;const section=heading[1]!;const body=writing.markdown.slice(heading.index,headings[index+1]?.index??writing.markdown.length);const plan=writing.figure_plan.find(item=>item.section===section);
    const inline=plan&&((plan.type==='mermaid'&&/```mermaid\s/.test(body))||(plan.type==='html_card'&&/<div\b/.test(body))||(plan.type==='table'&&/^\|.+\|$/m.test(body)));
    if(!plan||(!plan.resource_path&&!plan.no_figure_reason&&!inline))throw new Error('figure_plan_missing');}
  const $=cheerio.load(stripped);const imageRefs=[...stripped.matchAll(/!\[[^\]]*\]\(([^\s)]+)\)/g)].map(match=>match[1]!).concat($('img[src]').toArray().map(element=>$(element).attr('src')!));
  if(allowedUrls){const registered=new Set(allowedUrls);const links=[...stripped.matchAll(/(?<!!)\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)].map(match=>match[1]!).concat($('a[href]').toArray().map(element=>$(element).attr('href')!),[...stripped.matchAll(/<(https?:\/\/[^\s>]+)>/g)].map(match=>match[1]!),[...stripped.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map(match=>match[0].replace(/[.,;]+$/,'')));
    for(const href of links){if(href.startsWith('//'))throw new Error('citation_protocol_denied');if(/^https?:\/\//.test(href)&&!registered.has(href))throw new Error(`unregistered_citation_url:${href}`);if(/^[a-z][a-z0-9+.-]*:/i.test(href)&&!/^https?:\/\//.test(href))throw new Error('citation_protocol_denied');}}
  for(const resource of writing.resources){safeRelative(resource.path);const bytes=availableFiles[resource.path];if(!bytes||digest(bytes)!==resource.hash)throw new Error('resource_file_mismatch');
    if(resource.source_path){safeRelative(resource.source_path);if(!resource.source_path.startsWith('图文件/')||!availableFiles[resource.source_path])throw new Error('figure_source_missing');}
    if(resource.visual_check!=='passed'&&(resource.core||!writing.degradations.length))throw new Error('visual_check_required_or_disclosed');
    if(!finalResources&&resource.url)throw new Error('resource_url_not_confirmed');
    if(scope==='preview'&&resource.url)throw new Error('preview_remote_resource');if(scope==='production'&&finalResources&&!resource.url)throw new Error('final_resource_url_missing');}
  for(const reference of imageRefs){if(scope==='preview'&&/^(?:https?:|\/)/.test(reference))throw new Error('preview_image_not_relative');
    const resource=writing.resources.find(item=>scope==='production'&&finalResources?item.url===reference:item.path===reference||`../${item.path}`===reference);
    if(!resource)throw new Error('unregistered_image_reference');}
}
export function validateReview(raw:unknown,writing:Writing,files:Record<string,Uint8Array>,resourceHash:string):Review {
  const review=parseModel<Review>(ReviewSchema,raw);const expectedFiles={...files,[writing.note_path]:Buffer.from(writing.markdown)};
  const expectedHashes=Object.fromEntries(Object.entries(expectedFiles).map(([file,bytes])=>[file,digest(bytes)]));
  if(JSON.stringify(Object.entries(review.file_hashes).sort())!==JSON.stringify(Object.entries(expectedHashes).sort())||review.resource_manifest_hash!==resourceHash)throw new Error('review_hash_mismatch');
  for(const issue of review.issues)if(!expectedHashes[issue.file])throw new Error('review_issue_file_unknown');return review;
}

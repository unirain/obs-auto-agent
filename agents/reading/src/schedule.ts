export type Schedulable={id:string;source_id:string;discovered_at:string;resuming:boolean;executable:boolean;priority:number;last_run_id:string|null};
/** No article, pending PR or cost count is consulted. Every unclaimed candidate remains in the queue. */
export function fairCandidates(items:Schedulable[],now:Date,run_id:string,last_source:string|null=null):Schedulable[]{
  const available=items.filter(item=>item.executable&&item.last_run_id!==run_id);const age=(item:Schedulable)=>now.getTime()-Date.parse(item.discovered_at);
  const oldest=available.filter(item=>age(item)>7*86400000).sort((a,b)=>a.discovered_at.localeCompare(b.discovered_at)||a.id.localeCompare(b.id));const overdue=new Set(oldest.map(item=>item.id));
  const buckets=new Map<string,Schedulable[]>();for(const item of available.filter(item=>!overdue.has(item.id))){const bucket=buckets.get(item.source_id)??[];bucket.push(item);buckets.set(item.source_id,bucket);}
  for(const bucket of buckets.values())bucket.sort((a,b)=>Number(b.resuming)-Number(a.resuming)||b.priority-a.priority||a.discovered_at.localeCompare(b.discovered_at)||a.id.localeCompare(b.id));
  const sources=[...buckets.keys()].sort();const start=last_source?sources.indexOf(last_source)+1:0;const rotated=[...sources.slice(start),...sources.slice(0,start)];const result=[...oldest];
  while([...buckets.values()].some(bucket=>bucket.length)){for(const source of rotated){const item=buckets.get(source)!.shift();if(item)result.push(item);}}return result;
}

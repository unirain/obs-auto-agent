import {assertUtcInstant} from '../contracts/utc.js';
import {parseSourceResult} from './records.js';
import {parseSourceHealth,type SourceEvent,type SourceHealth} from '../monitor/contracts.js';
export type {SourceEvent,SourceHealth} from '../monitor/contracts.js';
import type { Scope } from '../stages/contracts.js';
import type {SourceResult} from './sources.js';
export const emptySourceHealth=():SourceHealth=>({schema_version:1,events:[],active:{},gaps:{},last_success:{}});
/** Call only in the same checkpoint as the page's candidates and cursor; never announce a recovery before committing it. */
export function applySourceResult(previous:SourceHealth,result:SourceResult,workspace_id:string,scope:Scope,now:string):SourceHealth {
  parseSourceHealth(previous);parseSourceResult(result);assertUtcInstant(now,'source event time');const next=structuredClone(previous);const emit=(reason_code:string,kind:SourceEvent['kind'],gap_id?:string)=>{const position=(next.events.at(-1)?.position??0)+1;next.events.push({event_id:`source_event_${position}`,position,workspace_id,execution_scope:scope,source_id:result.source_id,reason_code,kind,occurred_at:now,...(gap_id?{gap_id}:{})});};
  if(result.status==='failed'||(result.status==='partial'&&result.last_success_at===null&&result.reason_code!=='pagination_pending')) {
    const reason=result.reason_code??'source_failed';const key=`${result.source_id}:${reason}`;const active=next.active[key];
    if(active){active.last_seen_at=now;active.consecutive_failures++;}else{next.active[key]={first_seen_at:now,last_seen_at:now,consecutive_failures:1};emit(reason,'occurred');}
  }
  if(result.cursor_after===null&&result.last_success_at&&result.attempted_at&&(result.status==='success'||result.status==='partial')) {
    next.last_success[result.source_id]=result.last_success_at;
    for(const key of Object.keys(next.active))if(key.startsWith(`${result.source_id}:`)){emit(key.slice(result.source_id.length+1),'recovered');delete next.active[key];}
  }
  if(result.coverage_gap&&['success','partial'].includes(result.status)){const gap=result.coverage_gap;const gap_id=`${result.source_id}:${gap.reason}:${gap.from}`;
    if(!next.gaps[gap_id]){next.gaps[gap_id]={from:gap.from,to:gap.to,status:'open'};emit('coverage_gap','coverage_gap',gap_id);}}
  return parseSourceHealth(next);
}
export function resolveGap(previous:SourceHealth,gap_id:string,resolution:{kind:'accepted'|'filled';reason:string;validated_fill:boolean},workspace_id:string,scope:Scope,now:string):SourceHealth {
  parseSourceHealth(previous);assertUtcInstant(now,'gap resolution time');if(!resolution.reason.trim()||(resolution.kind==='filled'&&!resolution.validated_fill))throw new Error('gap_resolution_evidence_required');if(previous.events.some(event=>event.workspace_id!==workspace_id||event.execution_scope!==scope))throw new Error('gap_resolution_scope_mismatch');const next=structuredClone(previous);const gap=next.gaps[gap_id];if(!gap)throw new Error('gap_not_found');if(gap.status!=='open')throw new Error('gap_already_disposed');gap.status=resolution.kind;
  const position=(next.events.at(-1)?.position??0)+1;next.events.push({event_id:`source_event_${position}`,position,workspace_id,execution_scope:scope,source_id:gap_id.split(':')[0]!,reason_code:'coverage_gap',kind:resolution.kind==='filled'?'gap_resolved':'accepted_gap',occurred_at:now,gap_id});return parseSourceHealth(next);
}

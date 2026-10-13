import {effectiveRuntimeLimits,type ResolvedRuntimeLimits} from './limits.js';
export class RunDeadline {
  readonly started_at:number;readonly deadline:number;readonly generation_deadline:number;
  constructor(started_at=Date.now(),duration_ms=60*60_000,close_ms=5*60_000,readonly abort_signal?:AbortSignal){if(!Number.isSafeInteger(started_at)||!Number.isSafeInteger(duration_ms)||!Number.isSafeInteger(close_ms)||duration_ms<=0||close_ms>=duration_ms||close_ms<0)throw new Error('invalid_deadline');this.started_at=started_at;this.deadline=started_at+duration_ms;this.generation_deadline=this.deadline-close_ms;}
  mayStart(now=Date.now()):boolean{return !this.abort_signal?.aborted&&now<this.generation_deadline;}
  requireStart(now=Date.now()):void {if(!this.mayStart(now))throw new Error(this.abort_signal?.aborted?'run_cancelled':'run_deadline');}
  signal(parent?:AbortSignal):{signal:AbortSignal;close:()=>void}{const controller=new AbortController();const timer=setTimeout(()=>controller.abort('run_deadline'),Math.max(0,this.generation_deadline-Date.now()));timer.unref();
    const sources=[parent,this.abort_signal].filter((value):value is AbortSignal=>!!value);const cancel=()=>controller.abort(sources.find(value=>value.aborted)?.reason);for(const source of sources){source.addEventListener('abort',cancel,{once:true});if(source.aborted)cancel();}
    return {signal:controller.signal,close:()=>{clearTimeout(timer);for(const source of sources)source.removeEventListener('abort',cancel);}};}
}
export type Counters={tool_calls:number;supplementary_materials:number;revisions:number;stalled_batches:number;total_tool_calls:number;total_materials:number;download_bytes?:number;download_resources?:number;total_download_bytes?:number};
export class BatchBudget {
  private tail:Promise<void>=Promise.resolve();private failure:unknown=null;
  constructor(public readonly counters:Counters,private readonly deadline:number,private readonly commit:(next:Counters)=>Promise<void>,limits:Partial<ResolvedRuntimeLimits>={}){this.limits=effectiveRuntimeLimits(limits);}
  private limits:ResolvedRuntimeLimits;
  tighten(limits:Partial<ResolvedRuntimeLimits>):void{this.limits=effectiveRuntimeLimits(this.limits,limits);}
  tool(supplementary=false):Promise<void>{const turn=this.tail.then(async()=>{if(this.failure)throw this.failure;if(Date.now()>=this.deadline)throw new Error('run_deadline');if(this.counters.tool_calls>=this.limits.max_tools_per_batch||(supplementary&&this.counters.supplementary_materials>=this.limits.max_references_per_batch))throw new Error('batch_yield');
    const next={...this.counters,tool_calls:this.counters.tool_calls+1,total_tool_calls:this.counters.total_tool_calls+1,supplementary_materials:this.counters.supplementary_materials+(supplementary?1:0),total_materials:this.counters.total_materials+(supplementary?1:0)};
    await this.commit(next);Object.assign(this.counters,next);});this.tail=turn.then(()=>{},error=>{if(!(error instanceof Error&&error.message==='batch_yield'))this.failure=error;});return turn;}
  download(bytes:number):Promise<void>{const turn=this.tail.then(async()=>{if(this.failure)throw this.failure;if(!Number.isInteger(bytes)||bytes<0)throw new Error('download_bytes_invalid');if((this.counters.download_bytes??0)+bytes>this.limits.max_download_bytes||(this.counters.download_resources??0)+1>this.limits.max_resources)throw new Error('batch_yield');
    const next={...this.counters,download_bytes:(this.counters.download_bytes??0)+bytes,download_resources:(this.counters.download_resources??0)+1,total_download_bytes:(this.counters.total_download_bytes??0)+bytes};await this.commit(next);Object.assign(this.counters,next);});this.tail=turn.then(()=>{},error=>{if(!(error instanceof Error&&error.message==='batch_yield'))this.failure=error;});return turn;}
  async finish(progress:boolean):Promise<void>{const next={...this.counters,stalled_batches:progress?0:this.counters.stalled_batches+1};await this.commit(next);Object.assign(this.counters,next);if(next.stalled_batches>=this.limits.max_no_progress_batches)throw new Error('research_stalled');}
  async revise():Promise<void>{if(this.counters.revisions>=this.limits.max_revision_rounds)throw new Error('quality_blocked');const next={...this.counters,revisions:this.counters.revisions+1};await this.commit(next);Object.assign(this.counters,next);}
}

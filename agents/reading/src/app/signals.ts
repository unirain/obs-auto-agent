import type {EventEmitter} from 'node:events';
/** A cancellation asks the active controller to persist facts; it never claims provider cancellation or zero billing. */
export function processCancellation(source:Pick<EventEmitter,'on'|'removeListener'>=process){
 const controller=new AbortController();
 const interrupt=()=>controller.abort('SIGINT'),terminate=()=>controller.abort('SIGTERM');
 source.on('SIGINT',interrupt);source.on('SIGTERM',terminate);
 return {signal:controller.signal,close(){source.removeListener('SIGINT',interrupt);source.removeListener('SIGTERM',terminate);}};
}

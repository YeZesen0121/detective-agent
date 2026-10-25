import { createWatchScheduler, type WatchScheduler, type WatchRuntimePort, type WatchLease } from '../watch/index.js';
import type { WatchComparisonInput, WatchDecision } from '../../shared/ports.js';
import type { WatchExecution } from '../watch/ports.js';
import type { WatchStore } from './watch-store.js';
import { ApiFault } from './errors.js';
export class WatchHost {
 private readonly scheduler:WatchScheduler;
 private timer:NodeJS.Timeout|null=null;
 private stopped=false;
 constructor(readonly store:WatchStore,execute:(lease:WatchLease,signal:AbortSignal)=>Promise<WatchExecution>,
   compare:(input:WatchComparisonInput,signal:AbortSignal)=>Promise<WatchDecision>,private readonly now:()=>string) {
  const runtime:WatchRuntimePort={
   claimDue:async at=>store.claimDue(at),claimManual:async(owner,id,at)=>store.claimManual(owner,id,at),
   heartbeat:async(lease,at)=>store.heartbeat(lease,at),execute,compare,
   finish:async(lease,result,at)=>store.finish(lease,result,at),fail:async(lease,code,at)=>store.fail(lease,code,at),
  };
  this.scheduler=createWatchScheduler(runtime,{now});
 }
 start() {if(this.timer||this.stopped)return;this.timer=setInterval(()=>{void this.scan().catch(()=>{});},30000);this.timer.unref();}
 async scan() {if(!this.stopped)await this.scheduler.tick();}
 request(owner:string,id:string,key:string) {
  if(this.stopped)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','后台任务宿主已停止接单。');
  const check=this.store.requestManual(owner,id,key,this.now());
  // Persistence precedes dispatch; busy returns void, queued ticket survives until a later scan.
  setImmediate(()=>{if(!this.stopped)void this.scheduler.checkNow(owner,id).catch(()=>{});});
  return check;
 }
 async stop() {this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=null;await this.scheduler.stop();}
}

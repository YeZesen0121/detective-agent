import { RuntimeCapabilitiesSchema,type RuntimeCapabilities } from '../../shared/capabilities-http.js';
import type { CapabilitiesApi } from '../api/capabilities.js';
import { parseInput,safeError,type SafeError } from '../api/client.js';
import { snapshot } from '../model/snapshot.js';
export interface CapabilitiesState{phase:'idle'|'loading'|'ready'|'error';data:RuntimeCapabilities|null;error:SafeError|null}
export function createCapabilitiesController(api:CapabilitiesApi){
 let state:CapabilitiesState=snapshot({phase:'idle',data:null,error:null}),scope:string|null=null,generation=0,disposed=false,io=new AbortController();const listeners=new Set<()=>void>();
 function update(p:CapabilitiesState){state=snapshot(p);for(const fn of listeners){try{fn();}catch{/* observer owns render errors */}}}
 async function refresh(){if(disposed||scope===null)return;const g=++generation;io.abort();io=new AbortController();const signal=io.signal;const valid=()=>!disposed&&g===generation&&!signal.aborted;update({phase:'loading',data:null,error:null});
  try{const value=await api.get(signal);if(valid())update({phase:'ready',data:parseInput(RuntimeCapabilitiesSchema,value),error:null});}catch(e){if(valid())update({phase:'error',data:null,error:safeError(e)});}
 }
 return{async setSession(next:string|null){if(disposed)return;generation++;io.abort();scope=next;update({phase:'idle',data:null,error:null});if(next!==null)await refresh();},refresh,getState:()=>state,subscribe(fn:()=>void){if(!disposed)listeners.add(fn);return()=>{listeners.delete(fn);};},dispose(){disposed=true;generation++;io.abort();listeners.clear();}};
}

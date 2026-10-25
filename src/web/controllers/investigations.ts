import { InvestigationsPageSchema,type InvestigationsPage } from '../../shared/investigations-http.js';
import type { InvestigationsApi } from '../api/investigations.js';
import { ClientError,parseInput,safeError,type SafeError } from '../api/client.js';
import { snapshot } from '../model/snapshot.js';

export interface InvestigationsState{scope:string|null;items:InvestigationsPage['items'];nextBefore:string|null;phase:'idle'|'loading'|'ready'|'error';error:SafeError|null}
export function createInvestigationsController(api:Pick<InvestigationsApi,'list'>){
 let state:InvestigationsState=snapshot({scope:null,items:[],nextBefore:null,phase:'idle',error:null}),generation=0,disposed=false,io=new AbortController();const listeners=new Set<()=>void>();
 function update(p:Partial<InvestigationsState>){state=snapshot({...state,...p});for(const fn of listeners){try{fn();}catch{/* rendering observer owns its error */}}}
 async function load(more:boolean){
  if(disposed||!state.scope||state.phase==='loading'||(more&&!state.nextBefore))return;const g=++generation,before=more?state.nextBefore:null;io.abort();io=new AbortController();const signal=io.signal,valid=()=>!disposed&&g===generation&&!signal.aborted;update({phase:'loading',error:null});
  try{const page=parseInput(InvestigationsPageSchema,await api.list(before,signal));if(!valid())return;if(page.nextBefore&&page.nextBefore===before)throw new ClientError('PROTOCOL_ERROR','案卷分页游标没有前进。');const items=more?[...state.items,...page.items]:page.items;const unique=new Map(items.map(item=>[item.id,item]));update({items:[...unique.values()],nextBefore:page.nextBefore,phase:'ready',error:null});}
  catch(error){if(valid()){const safe=safeError(error);update({phase:'error',error:safe,...(safe.status===401?{items:[],nextBefore:null}:{})});}}
 }
 return{async setSession(scope:string|null){generation++;io.abort();update({scope,items:[],nextBefore:null,phase:'idle',error:null});if(scope)await load(false);},refresh:()=>load(false),more:()=>load(true),getState:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},dispose(){disposed=true;generation++;io.abort();listeners.clear();}};
}

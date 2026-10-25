import { IdSchema, ResultVersionSchema, type ResultVersion } from '../../shared/contracts.js';
import { CreateFollowupSchema, FollowupViewSchema } from '../../shared/followup-http.js';
import { ResultViewSchema, StartedRunSchema } from '../../shared/runtime-http.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import type { FollowupApi, FollowupView } from '../api/followup.js';
import type { RuntimeApi } from '../api/runtime.js';
import { createFollowupJournal, questionFingerprint, type FollowupJournal, type FollowupSubmission } from '../model/followup-submission.js';
import { snapshot } from '../model/snapshot.js';

export interface FollowupState{version:ResultVersion|null;question:string;items:FollowupView[];submissions:FollowupSubmission[];busy:boolean;loading:boolean;latestResultVersionId:string|null;error:SafeError|null}
export function createFollowupController({api,runtime,journal=createFollowupJournal(),onFollowRun}:{api:FollowupApi;runtime:RuntimeApi;journal?:FollowupJournal;onFollowRun:(caseId:string,runId:string)=>Promise<void>}){
 let state:FollowupState=snapshot({version:null,question:'',items:[],submissions:[],busy:false,loading:false,latestResultVersionId:null,error:null});
 let disposed=false,generation=0,readSeq=0,delay=1000;let io=new AbortController(),timer:ReturnType<typeof setTimeout>|undefined;const followed=new Set<string>(),listeners=new Set<()=>void>();
 const current=(g:number)=>!disposed&&generation===g&&!io.signal.aborted;
 const records=()=>journal.list().filter(r=>r.caseId===state.version?.investigationId&&r.versionId===state.version.id);
 function update(p:Partial<FollowupState>){state=snapshot({...state,...p,submissions:records()});for(const fn of listeners){try{fn();}catch{/* observer owns render errors */}}}
 function failure(e:unknown){const error=safeError(e);if(error.status===401){journal.clear();io.abort();if(timer)clearTimeout(timer);update({items:[],error});}else update({error});}
 const protocol=()=>new ClientError('PROTOCOL_ERROR','追问版本、归属或引用与当前报告不一致。');
 const unknown=(e:unknown)=>['NETWORK_ERROR','ABORTED','INVALID_RESPONSE','PROTOCOL_ERROR','INTERNAL_ERROR'].includes(safeError(e).code);
 function check(raw:FollowupView){const value=parseInput(FollowupViewSchema,raw),version=state.version!;if(value.investigationId!==version.investigationId||value.resultVersionId!==version.id)throw protocol();const turn=value.turn;if(turn&&(turn.id!==value.id||turn.resultVersionId!==version.id||turn.investigationId!==version.investigationId||turn.question!==value.question||turn.claimIds.some(id=>!version.payload.claims.some(c=>c.id===id))))throw protocol();if(value.evidenceIds.some(id=>!version.payload.evidence.some(e=>e.id===id)))throw protocol();return value;}
 function mergeItem(item:FollowupView){const index=state.items.findIndex(t=>t.id===item.id);const items=[...state.items];if(index<0)items.push(item);else items[index]=item;update({items});}
 async function follow(items:FollowupView[],g:number){for(const item of items){const runId=item.turn?.newRunId;if(!runId||followed.has(runId)||!current(g))continue;await onFollowRun(item.investigationId,runId);if(current(g))followed.add(runId);}}
 function schedule(){if(timer)clearTimeout(timer);if(disposed||io.signal.aborted||state.busy)return;if(state.items.some(x=>['queued','running'].includes(x.status))||records().some(r=>r.outcome==='pending'||r.outcome==='unknown')){timer=setTimeout(()=>{void refresh();},delay);delay=Math.min(delay*2,15000);}}
 async function refresh(){
  if(disposed||!state.version||state.busy||io.signal.aborted)return;const g=generation,r=++readSeq,signal=io.signal,version=state.version;const valid=()=>current(g)&&r===readSeq;update({loading:true});
  try{
   if(state.error?.code==='STALE_VERSION'){const result=parseInput(ResultViewSchema,await runtime.getResult(version.id,signal));if(!valid())return;if(result.version.id!==version.id||result.version.investigationId!==version.investigationId)throw protocol();update({latestResultVersionId:result.updateNotice?.latestResultVersionId??null});}
   const recovered:FollowupView[]=[];
   for(const entry of records()){
    if(entry.kind==='question'&&['pending','unknown'].includes(entry.outcome)){const value=await api.submission(version.investigationId,entry.key,signal);if(!valid())return;if(value.submission){const item=check(await api.get(value.submission.followupTurnId,signal));if(!valid())return;journal.put({...entry,turnId:item.id,outcome:'confirmed'});recovered.push(item);}}
    else if(entry.kind==='budget'&&entry.turnId&&['pending','unknown','confirmed'].includes(entry.outcome)){const item=check(await api.get(entry.turnId,signal));if(!valid())return;recovered.push(item);if(item.turn?.newRunId)journal.put({...entry,outcome:'confirmed',runId:item.turn.newRunId});}
   }
   let after:number|null=null;const items:FollowupView[]=[];let drained=false;
   for(let pageNo=0;pageNo<100;pageNo++){const page=await api.list(version.investigationId,after,signal);if(!valid())return;if(page.items.some(x=>x.investigationId!==version.investigationId))throw protocol();for(const item of page.items)if(item.resultVersionId===version.id)items.push(check(item));if(page.nextAfter===null){drained=true;break;}if(!Number.isSafeInteger(page.nextAfter)||page.nextAfter<0||(after!==null&&page.nextAfter<=after))throw protocol();after=page.nextAfter;}
   if(!drained||new Set(items.map(x=>x.id)).size!==items.length)throw protocol();
   // Single-turn polling avoids history races losing accepted/in-flight IDs.
   const ids=new Set([...state.items,...recovered].filter(x=>['queued','running'].includes(x.status)||!items.some(i=>i.id===x.id)).map(x=>x.id));
   for(const id of ids){const item=check(await api.get(id,signal));if(!valid())return;const index=items.findIndex(x=>x.id===id);if(index<0)items.push(item);else items[index]=item;}
   if(!valid())return;update({items});await follow(items,g);
  }catch(e){if(valid())failure(e);}finally{if(valid()){update({loading:false});schedule();}}
 }
 async function ask(){
  if(disposed||!state.version||state.busy||state.loading||io.signal.aborted||records().some(r=>['unknown','pending'].includes(r.outcome)))return;
  const g=generation,version=state.version;update({busy:true,error:null});readSeq++;let entry:FollowupSubmission|undefined;
  try{const input=parseInput(CreateFollowupSchema,{resultVersionId:version.id,question:state.question});const fingerprint=await questionFingerprint(input.question);if(!current(g))return;
   const previous=records().find(r=>r.kind==='question'&&r.fingerprint===fingerprint);if(previous?.outcome==='confirmed')return;
   entry=previous??{kind:'question',caseId:version.investigationId,versionId:version.id,key:crypto.randomUUID(),fingerprint,turnId:null,previousRunId:null,runId:null,outcome:'pending'};entry={...entry,outcome:'pending'};journal.put(entry);update({});
   const ack=await api.create(version.investigationId,input,entry.key,io.signal);if(!current(g))return;journal.put({...entry,turnId:ack.followupTurnId,outcome:'confirmed'});const item=check(await api.get(ack.followupTurnId,io.signal));if(!current(g))return;mergeItem(item);await follow([item],g);
  }catch(e){if(current(g)){if(entry){const saved=journal.list().find(r=>r.key===entry!.key);if(saved?.outcome==='pending')journal.put({...entry,outcome:unknown(e)?'unknown':'failed'});}failure(e);}}
  finally{if(current(g)){update({busy:false});delay=1000;await refresh();}}
 }
 async function confirmBudget(turnId:string,previousRunId:string){
  if(disposed||!state.version||state.busy||state.loading||io.signal.aborted)return;const item=state.items.find(x=>x.id===turnId);if(item?.turn?.route!=='needs_budget_confirmation'||!item.researchPurpose?.trim()||item.turn.newRunId||item.error?.code==='STALE_VERSION')return;
  const g=generation,version=state.version;let entry:FollowupSubmission|undefined;update({busy:true,error:null});readSeq++;
  try{parseInput(IdSchema,previousRunId);const prior=records().find(r=>r.kind==='budget'&&r.turnId===turnId);if(prior&&prior.outcome!=='failed')return;
   entry=prior??{kind:'budget',caseId:version.investigationId,versionId:version.id,key:crypto.randomUUID(),fingerprint:turnId,turnId,previousRunId,runId:null,outcome:'pending'};entry={...entry,outcome:'pending'};journal.put(entry);update({});
   const ack=parseInput(StartedRunSchema,await runtime.startRun(version.investigationId,{action:'add_budget',previousRunId:entry.previousRunId,followupTurnId:turnId},entry.key,io.signal));if(!current(g))return;journal.put({...entry,outcome:'confirmed',runId:ack.runId});await onFollowRun(version.investigationId,ack.runId);if(current(g))followed.add(ack.runId);
  }catch(e){if(current(g)){if(entry)journal.put({...entry,outcome:unknown(e)?'unknown':'failed'});failure(e);}}
  finally{if(current(g)){update({busy:false});delay=1000;await refresh();}}
 }
 return{
  async open(version:ResultVersion){if(disposed)return;const parsed=parseInput(ResultVersionSchema,version),same=state.version?.id===parsed.id;io.abort();io=new AbortController();generation++;readSeq++;if(timer)clearTimeout(timer);delay=1000;for(const row of journal.list().filter(r=>r.caseId===parsed.investigationId&&r.versionId===parsed.id&&r.outcome==='pending'))journal.put({...row,outcome:'unknown'});update({version:parsed,question:same?state.question:'',items:[],busy:false,loading:false,latestResultVersionId:null,error:null});await refresh();},
  setQuestion(question:string){if(!disposed)update({question});},ask,refresh,confirmBudget,
  async followTurn(turnId:string){const item=state.items.find(x=>x.id===turnId),runId=item?.turn?.newRunId;if(!disposed&&item&&runId){try{await onFollowRun(item.investigationId,runId);}catch(e){failure(e);}}},
  getState:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  dispose(){if(disposed)return;disposed=true;generation++;readSeq++;io.abort();if(timer)clearTimeout(timer);listeners.clear();},
 };
}
export type FollowupController=ReturnType<typeof createFollowupController>;

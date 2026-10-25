import { ResultVersionSchema, type ResultVersion } from '../../shared/contracts.js';
import { CompanionPatchSchema, CompanionQuestionSchema } from '../../shared/experience-http.js';
import type { CompanionView, ExperienceApi, TurnHistory } from '../api/experience.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import { projectCompanion } from '../model/companion.js';
import { snapshot } from '../model/snapshot.js';
import { createMediaJournal, newSubmission, unknownSubmission, type MediaJournal, type SubmissionRecord } from './media-submission.js';

export interface CompanionState {version:ResultVersion|null;view:CompanionView|null;turns:TurnHistory[];loading:boolean;busy:boolean;submission:SubmissionRecord|null;error:SafeError|null}
export function createCompanionSessionController({api,journal=createMediaJournal(),onInterrupt=()=>{}}:{api:ExperienceApi;journal?:MediaJournal;onInterrupt?:()=>void}){
 let state:CompanionState=snapshot({version:null,view:null,turns:[],loading:false,busy:false,submission:null,error:null});
 let disposed=false,generation=0,readSeq=0,revision=0,delay=1000;let io=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const listeners=new Set<()=>void>();const valid=(g:number)=>!disposed&&g===generation;
 const protocol=()=>new ClientError('PROTOCOL_ERROR','伴读版本、引用或历史游标不匹配。');
 function update(p:Partial<CompanionState>){state=snapshot({...state,...p});for(const fn of listeners)fn();}
 function fail(e:unknown){const error=safeError(e);if(error.status===401){journal.clear();if(timer)clearTimeout(timer);io.abort();update({view:null,turns:[],submission:null,error});}else update({error});}
 function check(view:CompanionView){if(!state.version)throw protocol();projectCompanion(view.session,state.version);if(state.view?.session.id===view.session.id&&state.view.session.status!=='generating'&&JSON.stringify(state.view.session.segments)!==JSON.stringify(view.session.segments))throw protocol();return view;}
 function needsPoll(){return state.view?.session.status==='generating'||state.turns.some(t=>['queued','running'].includes(t.view.status))||state.submission?.outcome==='unknown';}
 function schedule(){if(timer)clearTimeout(timer);if(disposed||io.signal.aborted||!needsPoll())return;timer=setTimeout(()=>{void refresh();},delay);delay=Math.min(delay*2,15000);}
 async function pages<T>(read:(after:number|null)=>Promise<{items:T[];nextAfter:number|null}>,g:number){let after:number|null=null;const items:T[]=[];for(let page=0;page<100;page++){const found=await read(after);if(!valid(g))return [];items.push(...found.items);if(found.nextAfter===null)return items;if(!Number.isSafeInteger(found.nextAfter)||found.nextAfter<0||(after!==null&&found.nextAfter<=after))throw protocol();after=found.nextAfter;}throw protocol();}
 async function refresh(){
  if(disposed||!state.version||state.busy||io.signal.aborted)return;const g=generation,r=++readSeq,v=revision,version=state.version,signal=io.signal;update({loading:true});
  const current=()=>valid(g)&&r===readSeq&&v===revision;
  try{
   const pending=journal.list().filter(x=>x.caseId===version.investigationId&&x.versionId===version.id&&['companion','turn'].includes(x.operation)&&['unknown','pending'].includes(x.outcome));
   for(const entry of pending){const found=await api.recover(version.investigationId,entry.operation,entry.key,signal);if(!current())return;
    if(found.submission){if(found.submission.operation!==entry.operation||!('resultVersionId'in found.submission)||found.submission.resultVersionId!==version.id|| (entry.parentId&&found.submission.companionSessionId!==entry.parentId))throw protocol();const confirmed={...entry,outcome:'confirmed' as const,submission:found.submission};journal.put(confirmed);update({submission:confirmed});}
    else update({submission:{...entry,outcome:'unknown'}});
   }
   let view=state.view;
   if(!view){const saved=await pages(after=>api.listCompanions(version.id,after,signal),g);if(!current())return;for(const item of saved)check(item);view=saved.at(-1)??null;}
   else view=await api.getCompanion(view.session.id,signal);
   if(!current())return;
   if(view){check(view);if(state.view&&view.session.id!==state.view.session.id)throw protocol();const turns=await pages(after=>api.listTurns(view!.session.id,after,signal),g);if(!current())return;
    if(new Set(turns.map(t=>t.turnId)).size!==turns.length)throw protocol();
    for(const turn of turns){const reply=turn.view.reply;if(reply&&(reply.resumeCursor>view.session.segments.length||reply.claimIds.some(id=>!version.payload.claims.some(c=>c.id===id))||reply.evidenceIds.some(id=>!version.payload.evidence.some(e=>e.id===id))))throw protocol();}
    update({view,turns});
   }
  }catch(e){if(current())fail(e);}finally{if(current()){update({loading:false});schedule();}}
 }
 async function submit(kind:'companion'|'turn',question?:string){
  if(disposed||!state.version||state.busy||state.loading||io.signal.aborted||state.submission?.outcome==='unknown')return;
  if(kind==='turn'&&state.view?.session.status!=='ready')return;
  if(kind==='companion'&&state.view&&state.view.session.status!=='failed')return;
  const g=generation,version=state.version,signal=io.signal;let entry:SubmissionRecord;
  try{if(kind==='turn')parseInput(CompanionQuestionSchema,{question});onInterrupt();entry=newSubmission(kind,version.investigationId,crypto.randomUUID(),version.id,kind==='turn'?state.view!.session.id:null);journal.put(entry);revision++;update({busy:true,error:null,submission:entry});
   if(kind==='companion'){const accepted=await api.createCompanion(version.id,entry.key,signal);if(!valid(g))return;const confirmed={...entry,outcome:'confirmed' as const,submission:{operation:'companion' as const,companionSessionId:accepted.companionSessionId,resultVersionId:version.id}};journal.put(confirmed);const view=await api.getCompanion(accepted.companionSessionId,signal);if(!valid(g))return;update({view:check(view),submission:confirmed});}
   else{const accepted=await api.ask(entry.parentId!,question!,entry.key,signal);if(!valid(g))return;const confirmed={...entry,outcome:'confirmed' as const,submission:{operation:'turn' as const,companionSessionId:entry.parentId!,resultVersionId:version.id,turnId:accepted.turnId}};journal.put(confirmed);update({submission:confirmed});}
  }catch(e){if(valid(g)){const active=state.submission;if(active?.outcome==='pending'){const changed={...active,outcome:unknownSubmission(e)?'unknown' as const:'failed' as const};journal.put(changed);update({submission:changed});}fail(e);}}
  finally{if(valid(g)){revision++;update({busy:false});delay=1000;await refresh();}}
 }
 async function patch(input:{cursor?:number;ended?:boolean}){
  if(disposed||!state.view||state.busy||io.signal.aborted)return;const g=generation,id=state.view.session.id;onInterrupt();if(timer)clearTimeout(timer);revision++;readSeq++;update({busy:true,loading:false,error:null});
  try{const validated=parseInput(CompanionPatchSchema,input);const saved=await api.patchCompanion(id,validated,io.signal);if(!valid(g))return;if(saved.id!==id)throw protocol();update({view:check({...state.view!,session:saved})});}
  catch(e){if(valid(g))fail(e);}finally{if(valid(g)){revision++;readSeq++;update({busy:false});schedule();}}
 }
 return {
  async open(version:ResultVersion){if(disposed)return;const parsed=parseInput(ResultVersionSchema,version);onInterrupt();io.abort();if(timer)clearTimeout(timer);io=new AbortController();generation++;readSeq++;revision++;delay=1000;const submission=journal.list().filter(r=>r.versionId===parsed.id&&r.caseId===parsed.investigationId&&['companion','turn'].includes(r.operation)).at(-1)??null;update({version:parsed,view:null,turns:[],loading:true,busy:false,error:null,submission:submission?.outcome==='pending'?{...submission,outcome:'unknown'}:submission});await refresh();},
  generate:()=>submit('companion'),ask:(question:string)=>submit('turn',question),selectCursor:(cursor:number)=>patch({cursor}),end:()=>patch({ended:true}),reopen:()=>patch({ended:false}),refresh,
  getState:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  dispose(){if(disposed)return;disposed=true;generation++;io.abort();if(timer)clearTimeout(timer);onInterrupt();listeners.clear();},
 };
}
export type CompanionSessionController=ReturnType<typeof createCompanionSessionController>;

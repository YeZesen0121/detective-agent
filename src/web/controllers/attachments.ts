import { IdSchema } from '../../shared/contracts.js';
import type { Attachment, ExperienceApi } from '../api/experience.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import { snapshot } from '../model/snapshot.js';
import { createMediaJournal, newSubmission, unknownSubmission, type MediaJournal, type SubmissionRecord } from './media-submission.js';

export interface AttachmentState { caseId:string|null;items:Attachment[];submissions:SubmissionRecord[];loading:boolean;canStart:boolean;error:SafeError|null }
export function createAttachmentController({api,journal=createMediaJournal()}:{api:ExperienceApi;journal?:MediaJournal}){
 let state:AttachmentState=snapshot({caseId:null,items:[],submissions:[],loading:false,canStart:false,error:null});
 let generation=0,disposed=false,reads=0,revision=0;let io=new AbortController();const flights=new Map<string,Promise<void>>();const sizes=new Map<string,number>();const listeners=new Set<()=>void>();
 const records=()=>journal.list().filter(r=>r.caseId===state.caseId&&r.operation==='attachment');
 function update(patch:Partial<AttachmentState>){state=snapshot({...state,...patch,submissions:records()});state=snapshot({...state,canStart:!!state.caseId&&!state.loading&&!state.error&&!state.submissions.some(r=>r.outcome==='pending'||r.outcome==='unknown')});for(const fn of listeners)fn();}
 function fail(error:unknown){const value=safeError(error);if(value.status===401){journal.clear();update({items:[],error:value});}else update({error:value});}
 async function refresh(clearError=true){
  if(disposed||!state.caseId)return;const g=generation,c=state.caseId,r=++reads,v=revision;const signal=io.signal;update({loading:true,...(clearError?{error:null}:{})});
  try{
   for(const entry of records().filter(r=>r.outcome==='unknown')){
    const found=await api.recover(c,'attachment',entry.key,signal);if(g!==generation||disposed)return;
    if(found.submission){if(found.submission.operation!=='attachment')throw new ClientError('PROTOCOL_ERROR','附件恢复结果不匹配。');journal.put({...entry,outcome:'confirmed',submission:found.submission});}
   }
   const list=await api.listAttachments(c,signal);if(g!==generation||r!==reads||v!==revision||disposed)return;
   if(list.items.some(x=>x.investigationId!==c)||new Set(list.items.map(x=>x.id)).size!==list.items.length)throw new ClientError('PROTOCOL_ERROR','附件列表不属于当前案件。');
   update({items:[...list.items].sort((a,b)=>a.order-b.order)});
  }catch(e){if(g===generation&&r===reads&&!disposed)fail(e);}finally{if(g===generation&&r===reads&&!disposed)update({loading:false});}
 }
 function upload(file:File,key:string=crypto.randomUUID()):Promise<void>{
  if(disposed||!state.caseId)return Promise.resolve();if(flights.has(key))return flights.get(key)!;
  const previous=records().find(r=>r.key===key);if(previous&&previous.outcome!=='failed')return Promise.resolve();
  const c=state.caseId,g=generation,signal=io.signal;
  const pending=records().filter(r=>r.outcome==='pending'||r.outcome==='unknown');
  if(file.size<=0||file.size>8*1024*1024||state.items.length+pending.length>=3||state.items.reduce((sum,x)=>sum+x.byteSize,0)+[...sizes.values()].reduce((a,b)=>a+b,0)+file.size>24*1024*1024){fail(new ClientError('VALIDATION_ERROR','最多 3 张截图，每张不超过 8 MiB，合计不超过 24 MiB。'));return Promise.resolve();}
  const entry=newSubmission('attachment',c,key);journal.put(entry);sizes.set(key,file.size);revision++;update({error:null});
  const promise=(async()=>{
   try{const attachment=await api.uploadAttachment(c,file,key,signal);if(g!==generation||disposed)return;if(attachment.investigationId!==c)throw new ClientError('PROTOCOL_ERROR','上传结果不属于当前案件。');journal.put({...entry,outcome:'confirmed',submission:{operation:'attachment',attachmentId:attachment.id,deleted:false}});}
   catch(e){if(g!==generation||disposed)return;journal.put({...entry,outcome:unknownSubmission(e)?'unknown':'failed'});fail(e);}
   finally{flights.delete(key);sizes.delete(key);if(g===generation&&!disposed){revision++;update({});await refresh(false);}}
  })();flights.set(key,promise);return promise;
 }
 return {
  async open(caseId:string){parseInput(IdSchema,caseId);io.abort();io=new AbortController();generation++;reads++;flights.clear();sizes.clear();for(const entry of journal.list().filter(r=>r.caseId===caseId&&r.operation==='attachment'&&r.outcome==='pending'))journal.put({...entry,outcome:'unknown'});state=snapshot({caseId,items:[],submissions:[],loading:true,canStart:false,error:null});await refresh();},
  upload,refresh,
  async remove(attachmentId:string){if(disposed||!state.caseId||state.loading)return;const g=generation,c=state.caseId;revision++;update({loading:true,error:null});try{await api.deleteAttachment(c,attachmentId,io.signal);}catch(e){if(g===generation&&!disposed)fail(e);}finally{if(g===generation&&!disposed){update({loading:false});await refresh();}}},
  getState:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  dispose(){disposed=true;generation++;io.abort();listeners.clear();},
 };
}
export type AttachmentController=ReturnType<typeof createAttachmentController>;

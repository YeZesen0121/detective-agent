import { z } from 'zod';
import { IdSchema, type AudioManifest } from '../../shared/contracts.js';
import { type ExperienceApi } from '../api/experience.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import { snapshot } from '../model/snapshot.js';
import { createAudioController, type AudioDriver, type AudioPlaybackState } from './audio.js';
import { createMediaJournal, newSubmission, unknownSubmission, type MediaJournal, type SubmissionRecord } from './media-submission.js';

const BindingSchema=z.strictObject({caseId:IdSchema,versionId:IdSchema,companionId:IdSchema,segmentId:IdSchema});
export type AudioBinding=z.infer<typeof BindingSchema>;
export interface AudioSessionState{binding:AudioBinding|null;manifest:AudioManifest|null;manifestVoiceId:string|null;voices:Awaited<ReturnType<ExperienceApi['voices']>>['items'];budget:Awaited<ReturnType<ExperienceApi['budget']>>|null;submission:SubmissionRecord|null;loading:boolean;busy:boolean;error:SafeError|null;playback:AudioPlaybackState}
export function createAudioSessionController({api,driver,journal=createMediaJournal()}:{api:ExperienceApi;driver:AudioDriver;journal?:MediaJournal}){
 const playback=createAudioController(driver);let state:AudioSessionState=snapshot({binding:null,manifest:null,manifestVoiceId:null,voices:[],budget:null,submission:null,loading:false,busy:false,error:null,playback:playback.getState()});
 let generation=0,readSeq=0,disposed=false,delay=1000;let savedSubmission:SubmissionRecord|null=null;let io=new AbortController(),timer:ReturnType<typeof setTimeout>|undefined;const listeners=new Set<()=>void>();
 const valid=(g:number)=>!disposed&&g===generation;function update(p:Partial<AudioSessionState>){state=snapshot({...state,...p});for(const fn of listeners)fn();}
 const unsubscribe=playback.subscribe(()=>update({playback:playback.getState()}));
 const protocol=()=>new ClientError('PROTOCOL_ERROR','音频任务与当前段落不匹配。');
 function fail(e:unknown){const error=safeError(e);if(error.status===401){journal.clear();io.abort();playback.stop();if(timer)clearTimeout(timer);update({submission:null,manifest:null,voices:[],budget:null,error});}else update({error});}
 function schedule(){if(timer)clearTimeout(timer);if(disposed||io.signal.aborted)return;if(state.submission?.outcome==='unknown'||(state.manifest&&!['ready','partial','failed','cancelled'].includes(state.manifest.status))){timer=setTimeout(()=>{void refresh();},delay);delay=Math.min(delay*2,15000);}}
 async function refresh(){
  if(disposed||!state.binding||io.signal.aborted)return;const g=generation,r=++readSeq,signal=io.signal,binding=state.binding;const current=()=>valid(g)&&r===readSeq;update({loading:true});
  try{let entry=state.submission;
   if(entry&&['unknown','pending'].includes(entry.outcome)){const found=await api.recover(binding.caseId,'audio',entry.key,signal);if(!current())return;if(found.submission){const sub=found.submission;if(sub.operation!=='audio'||sub.resultVersionId!==binding.versionId||sub.companionSessionId!==binding.companionId)throw protocol();entry={...entry,outcome:'confirmed',submission:sub};journal.put(entry);savedSubmission=entry;update({submission:entry});}}
   const saved=savedSubmission,sub=saved?.submission;if(sub?.operation==='audio'){const manifest=await api.getAudio(sub.audioJobId,signal);if(!current())return;if(manifest.jobId!==sub.audioJobId)throw protocol();update({manifest,manifestVoiceId:saved!.voiceId});}
  }catch(e){if(current())fail(e);}finally{if(current()){update({loading:false});schedule();}}
 }
 return {
  async open(binding:AudioBinding){if(disposed)return;parseInput(BindingSchema,binding);playback.stop();io.abort();io=new AbortController();if(timer)clearTimeout(timer);generation++;readSeq++;delay=1000;const g=generation;const records=journal.list().filter(r=>r.operation==='audio'&&r.caseId===binding.caseId&&r.versionId===binding.versionId&&r.parentId===binding.companionId&&r.segmentId===binding.segmentId);const entry=records.at(-1)??null;savedSubmission=records.filter(r=>r.outcome==='confirmed'&&r.submission?.operation==='audio').at(-1)??null;
   update({binding,manifest:null,manifestVoiceId:null,voices:[],budget:null,submission:entry?.outcome==='pending'?{...entry,outcome:'unknown'}:entry,loading:true,busy:false,error:null});
   try{const voices=await api.voices(io.signal);if(!valid(g))return;update({voices:voices.items.filter(v=>v.available)});if(api.budget){const budget=await api.budget(binding.caseId,io.signal);if(!valid(g))return;update({budget});}}catch(e){if(valid(g))fail(e);}if(valid(g))await refresh();
  },
  async generate(voiceId:string,retry=false){
   if(disposed||!state.binding||state.busy||state.loading||io.signal.aborted||state.submission?.outcome==='unknown'||state.submission?.outcome==='pending')return;
   if(retry&&(!state.manifestVoiceId||voiceId!==state.manifestVoiceId)){fail(new ClientError('VALIDATION_ERROR','重试须沿用当前音频的音色；更换音色请显式生成新音频。'));return;}
   if(state.manifest&&(!['ready','partial','failed','cancelled'].includes(state.manifest.status)||(voiceId===state.manifestVoiceId&&(!retry||state.manifest.status==='ready'))))return;
   if(!state.voices.some(v=>v.id===voiceId&&v.available)){fail(new ClientError('VALIDATION_ERROR','请选择服务器提供的可用音色。'));return;}
   const binding=state.binding,g=generation,entry={...newSubmission('audio',binding.caseId,crypto.randomUUID(),binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId};journal.put(entry);playback.stop();readSeq++;update({submission:entry,busy:true,error:null});
   try{const accepted=await api.requestAudio(binding.companionId,{segmentId:binding.segmentId,voiceId,speed:0},entry.key,io.signal);if(!valid(g))return;const confirmed={...entry,outcome:'confirmed' as const,submission:{operation:'audio' as const,audioJobId:accepted.audioJobId,resultVersionId:binding.versionId,companionSessionId:binding.companionId}};journal.put(confirmed);savedSubmission=confirmed;update({submission:confirmed,manifest:null});}
   catch(e){if(valid(g)){const changed={...entry,outcome:unknownSubmission(e)?'unknown' as const:'failed' as const};journal.put(changed);update({submission:changed});fail(e);}}
   finally{if(valid(g)){update({busy:false});delay=1000;await refresh();}}
  },
  async play(){if(disposed||!state.manifest||state.playback.status==='playing')return;const manifest=state.manifest;
   // Cancellation keeps saved chunks. Present the playable prefix as partial, never ready.
   await playback.play(['cancelled','failed'].includes(manifest.status)?{...manifest,status:'partial'}:manifest,playback.getState().epoch);
  },
  stop:()=>playback.stop(),refresh,
  disconnect(){if(disposed)return;generation++;readSeq++;io.abort();if(timer)clearTimeout(timer);playback.stop();update({loading:false,busy:false});},
  async cancel(){if(disposed||!state.manifest||state.busy)return;const g=generation,job=state.manifest.jobId;playback.stop();readSeq++;update({busy:true,error:null});try{const manifest=await api.cancelAudio(job,io.signal);if(!valid(g))return;if(manifest.jobId!==job)throw protocol();update({manifest});}catch(e){if(valid(g))fail(e);}finally{if(valid(g)){update({busy:false});await refresh();}}},
  getState:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  dispose(){if(disposed)return;disposed=true;generation++;io.abort();if(timer)clearTimeout(timer);unsubscribe();playback.dispose();listeners.clear();},
 };
}
export type AudioSessionController=ReturnType<typeof createAudioSessionController>;

import { z } from 'zod';
import { AudioJobSchema, AudioManifestSchema, type AudioJob } from '../../shared/contracts.js';
import { RequestAudioSchema } from '../../shared/experience-http.js';
import { ApiFault } from './errors.js';
import { hashValue } from './snapshots.js';
import { byteHash, type PrivateAssets } from './private-assets.js';
import type { ExperienceJob, ExperienceStore } from './experience-store.js';
import { SpeechVoiceBindingSchema, type SpeechVoiceBinding } from './experience-ports.js';
const invalid=()=>new ApiFault(409,'INVALID_STATE','音频与已保存段落或任务不一致。');
const missing=()=>new ApiFault(404,'NOT_FOUND','未找到该音频任务。');
const status=(job:ExperienceJob,hasChunks:boolean):AudioJob['status']=>job.status==='running'?'generating':job.status==='completed'?'ready':job.status==='failed'&&hasChunks?'partial':job.status;
export class ExperienceAudio {
 constructor(readonly store:ExperienceStore,readonly assets:PrivateAssets){}
 private chunks(id:string){return this.store.db.prepare('SELECT chunk_index,asset_id,text_hash FROM audio_chunks WHERE job_id=? ORDER BY chunk_index').all(id) as Array<{chunk_index:number;asset_id:string;text_hash:string}>;}
 private assertSegmentReconciled(owner:string,companionId:string,segmentId:string){const rows=this.store.db.prepare("SELECT id FROM experience_jobs WHERE session_id=? AND companion_session_id=? AND kind='audio' AND json_extract(request_json,'$.segmentId')=?").all(owner,companionId,segmentId) as {id:string}[];for(const row of rows)this.store.assertSpeechReconciled(row.id);}
 private invalidate(id:string,owner:string,at:string){const job=this.store.job(id,owner);if(!job||job.kind!=='audio')throw missing();let changed=false;for(const chunk of this.chunks(id)){try{this.assets.readAsset(chunk.asset_id,owner,at);}catch{this.store.db.prepare('DELETE FROM audio_chunks WHERE job_id=? AND chunk_index=?').run(id,chunk.chunk_index);this.assets.retireAudio(chunk.asset_id,owner,at);changed=true;}}if(changed&&job.status==='completed')this.store.db.prepare("UPDATE experience_jobs SET status='partial',error_code='AUDIO_CACHE_UNAVAILABLE' WHERE id=?").run(id);}
 record(id:string,owner:string,at=new Date().toISOString()){this.invalidate(id,owner,at);const job=this.store.job(id,owner),row=this.store.db.prepare('SELECT payload_json FROM audio_jobs WHERE id=?').get(id) as {payload_json:string}|undefined;if(!job||job.kind!=='audio'||!row)throw missing();const audio=AudioJobSchema.parse(JSON.parse(row.payload_json)),chunks=this.chunks(id).map(c=>({index:c.chunk_index,assetId:c.asset_id,status:'ready' as const,durationMs:null}));return AudioJobSchema.parse({...audio,status:status(job,!!chunks.length),chunks,error:job.errorCode});}
 manifest(id:string,owner:string,at=new Date().toISOString()){const record=this.record(id,owner,at);return AudioManifestSchema.parse({jobId:id,status:record.status,chunks:record.chunks.map(({durationMs:_duration,...c})=>c),error:record.error});}
 create(owner:string,companionId:string,key:string,raw:z.infer<typeof RequestAudioSchema>,voice:{id:string;providerVersion:string;splitVersion:string;binding?:SpeechVoiceBinding},at:string){return this.store.db.transaction(()=>{
  const request=RequestAudioSchema.parse(raw),body={companionId,...request},prior=this.store.prior(owner,'audio',key,body);if(prior){this.invalidate(prior.id,owner,at);return this.store.job(prior.id,owner)!;}
  const {session,voiceId}=this.store.companion(companionId,owner),segment=session.segments.find(s=>s.id===request.segmentId);
  if(session.status!=='ready'||!segment||voice.id!==request.voiceId||voiceId&&voiceId!==voice.id)throw invalid();
  const voiceBinding=voice.binding?SpeechVoiceBindingSchema.parse(voice.binding):undefined;if(voiceBinding&&voiceBinding.id!==voice.id)throw invalid();
  const cacheKey=hashValue({owner,version:session.resultVersionId,segmentId:segment.id,text:hashValue(segment.text),provider:voice.providerVersion,voice:voice.id,speed:0,codec:'mp3',split:voice.splitVersion,...(voiceBinding?{voiceBinding}:{})});
  const cached=this.store.db.prepare('SELECT id FROM audio_jobs WHERE cache_key=?').get(cacheKey) as {id:string}|undefined;
  if(cached){this.invalidate(cached.id,owner,at);const job=this.store.job(cached.id,owner)!;
   if(!['queued','running','completed'].includes(job.status)){
    // A new explicit request may retry missing chunks; an old key returned above never requeues.
    this.assertSegmentReconciled(owner,companionId,segment.id);
    this.store.requeue(job.id,owner,at);
   }
   this.store.remember(owner,'audio',key,body,job.id);return this.store.job(job.id)!;
  }
  this.assertSegmentReconciled(owner,companionId,segment.id);this.store.db.prepare('UPDATE companion_sessions SET voice_id=? WHERE id=?').run(voice.id,companionId);
  const job=this.store.enqueue(owner,session,'audio',{...request,text:segment.text,providerVersion:voice.providerVersion,splitVersion:voice.splitVersion,...(voiceBinding?{voiceBinding}:{})},at);
  const audio=AudioJobSchema.parse({id:job.id,sessionId:owner,resultVersionId:session.resultVersionId,companionSessionId:companionId,segmentId:segment.id,voiceId:voice.id,speed:0,cacheKey,status:'queued',chunks:[],error:null});
  this.store.db.prepare('INSERT INTO audio_jobs VALUES (?,?,?)').run(job.id,cacheKey,JSON.stringify(audio));this.store.remember(owner,'audio',key,body,job.id);return job;
 }).immediate();}
 cached(id:string,index:number,text:string,owner:string,at:string){this.invalidate(id,owner,at);const row=this.chunks(id).find(c=>c.chunk_index===index);if(!row)return null;if(row.text_hash!==hashValue(text))throw invalid();return{assetId:row.asset_id,bytes:this.assets.readAsset(row.asset_id,owner,at).bytes};}
 saveChunk(id:string,epoch:number,index:number,text:string,bytes:Buffer,at:string){return this.store.db.transaction(()=>{
  const job=this.store.assertJob(id,epoch);if(job.kind!=='audio')throw invalid();z.number().int().min(0).max(99).parse(index);
  const old=this.chunks(id).find(c=>c.chunk_index===index);
  if(old){const stored=this.assets.readAsset(old.asset_id,job.sessionId,at);if(old.text_hash!==hashValue(text)||byteHash(bytes)!==stored.sha256)throw invalid();return{index,assetId:old.asset_id};}
  const size=this.store.db.prepare('SELECT COALESCE(SUM(a.byte_size),0) n FROM audio_chunks c JOIN private_assets a ON a.id=c.asset_id WHERE c.job_id=?').get(id) as {n:number};if(size.n+bytes.length>32*1024*1024)throw new ApiFault(409,'INVALID_STATE','该段音频缓存过大。');
  const assetId=this.assets.writeAudio(job.sessionId,job.investigationId,bytes,at);this.store.db.prepare('INSERT INTO audio_chunks VALUES (?,?,?,?)').run(id,index,assetId,hashValue(text));return{index,assetId};
 }).immediate();}
 finish(id:string,epoch:number,raw:z.infer<typeof AudioManifestSchema>,at:string){return this.store.db.transaction(()=>{
  const job=this.store.assertJob(id,epoch),manifest=AudioManifestSchema.parse(raw),stored=this.manifest(id,job.sessionId,at);
  if(job.kind!=='audio'||manifest.jobId!==id||!['ready','partial','failed','cancelled'].includes(manifest.status)||['ready','partial'].includes(manifest.status)&&!stored.chunks.length||manifest.chunks.length!==stored.chunks.length||manifest.chunks.some((c,i)=>c.index!==stored.chunks[i]!.index||c.assetId!==stored.chunks[i]!.assetId||c.status!=='ready'))throw invalid();
  const terminal=manifest.status==='failed'&&stored.chunks.length?'partial':manifest.status;
  const error=terminal==='ready'?null:/^SPEECH_[A-Z][A-Z0-9_]{0,79}$/.test(manifest.error??'')?manifest.error:terminal==='cancelled'?'AUDIO_CANCELLED':terminal==='partial'?'AUDIO_PARTIAL':'AUDIO_FAILED';
  const output={...stored,status:terminal,error};this.store.finish(id,epoch,terminal==='ready'?'completed':terminal as 'partial'|'failed'|'cancelled',output,error,at);return output;
 }).immediate();}
}

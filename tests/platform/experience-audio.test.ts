import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { experienceDraft, experienceSeed } from '../helpers/experience.js';
import { PrivateAssets } from '../../src/server/platform/private-assets.js';
import { ExperienceAudio } from '../../src/server/platform/experience-audio.js';
import { ExperienceStore } from '../../src/server/platform/experience-store.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
const closers:Array<()=>void>=[];afterEach(()=>{for(const close of closers.splice(0))close();});
function setup(){const s=experienceSeed(),root=mkdtempSync(join(tmpdir(),'controlled-audio-')),assets=new PrivateAssets(s.db,root),audio=new ExperienceAudio(s.store,assets);
 const session=s.store.createCompanion(s.owner,s.version.id,'controlled-companion',s.at),job=s.store.claim(s.at)!;s.store.finishCompanion(job.id,job.epoch,experienceDraft(s),s.at);
 closers.push(()=>{s.db.close();rmSync(root,{recursive:true,force:true});});return{...s,assets,audio,session:s.store.companion(session.id,s.owner).session};}
const voice={id:'controlled_voice',providerVersion:'controlled_fixture_tts_v1',splitVersion:'sentences-v1'};
const mp3=()=>Buffer.concat([Buffer.from([255,251,144,100]),Buffer.alloc(413)]); // controlled_fixture frame, not an audible TTS assertion.
it.each(['failed','cancelled'] as const)('accepts a legitimate empty %s manifest without fabricating a ready chunk',terminal=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};
 s.audio.create(s.owner,s.session.id,'controlled-terminal',request,voice,s.at);const job=s.store.claim(s.at)!,error=terminal==='failed'?'SPEECH_INVALID_AUDIO':'SPEECH_ABORTED';
 const result=s.audio.finish(job.id,job.epoch,{jobId:job.id,status:terminal,chunks:[],error},s.at);
 expect(result).toMatchObject({status:terminal,chunks:[],error});expect(s.audio.manifest(job.id,s.owner,s.at)).toMatchObject({status:terminal,error});
 expect(()=>s.store.assertJob(job.id,job.epoch)).toThrow();
});
it('does not replay a missing chunk until both character and money records are reconciled',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};
 s.audio.create(s.owner,s.session.id,'controlled-unknown',request,voice,s.at);const job=s.store.claim(s.at)!,ctx=s.store.context(job.id,s.at),callId=randomUUID();
 const token=s.store.reserveCharacters(job.id,job.epoch,10,{index:0,requestHash:'a'.repeat(64),at:s.at});
 s.book.reserve(ctx,['runtime:global','runtime:trial',ctx.interactionPoolId!],{callId,provider:'controlled_fixture',operation:'tts',purpose:'controlled_fixture',attemptNo:1,priceRevision:'controlled_fixture-v1',estimated:{...zeroAmounts(),moneyMicros:20}});
 s.book.markSent(callId);s.store.markCharactersSent(token,callId);s.book.markUnknown(callId);s.store.settleCharacters(token,null);s.store.cancel(job.id,s.owner,s.at);
 const reloaded=new ExperienceStore(s.db,s.ends),audio=new ExperienceAudio(reloaded,s.assets);
 expect(audio.create(s.owner,s.session.id,'controlled-unknown',request,voice,s.at).status).toBe('cancelled');
 expect(()=>audio.create(s.owner,s.session.id,'controlled-not-reconciled',request,voice,s.at)).toThrow();
 s.store.settleCharacters(token,10);expect(()=>audio.create(s.owner,s.session.id,'controlled-money-unknown',request,voice,s.at)).toThrow();
 s.book.settle(callId,{...zeroAmounts(),moneyMicros:20},'controlled_reconciled');
 expect(audio.create(s.owner,s.session.id,'controlled-after-reconciliation',request,voice,s.at).status).toBe('queued');
});
it('rejects a second paid reservation for a still unknown chunk even if an internal caller requeues the job',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};s.audio.create(s.owner,s.session.id,'controlled-unknown',request,voice,s.at);
 const job=s.store.claim(s.at)!,token=s.store.reserveCharacters(job.id,job.epoch,10,{index:0,requestHash:'a'.repeat(64),at:s.at});s.store.markCharactersSent(token);s.store.settleCharacters(token,null);s.store.cancel(job.id,s.owner,s.at);
 s.store.requeue(job.id,s.owner,s.at);const next=s.store.claim(s.at)!;
 expect(()=>s.store.reserveCharacters(next.id,next.epoch,10,{index:0,requestHash:'a'.repeat(64),at:s.at})).toThrow();
 expect(s.db.prepare('SELECT count(*) n FROM experience_tts_attempts WHERE job_id=?').get(job.id)).toMatchObject({n:1});
});
it('allows ready cache reuse without a fee but cannot bypass reconciliation by changing the provider revision',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};s.audio.create(s.owner,s.session.id,'controlled-cache-unknown',request,voice,s.at);
 const job=s.store.claim(s.at)!,ctx=s.store.context(job.id,s.at),callId=randomUUID(),token=s.store.reserveCharacters(job.id,job.epoch,10,{index:0,requestHash:'a'.repeat(64),at:s.at});
 s.book.reserve(ctx,['runtime:global','runtime:trial',ctx.interactionPoolId!],{callId,provider:'controlled_fixture',operation:'tts',purpose:'controlled_fixture',attemptNo:1,priceRevision:'controlled_fixture-v1',estimated:{...zeroAmounts(),moneyMicros:20}});
 s.book.markSent(callId);s.store.markCharactersSent(token,callId);s.store.settleCharacters(token,10);s.book.markUnknown(callId);
 const chunk=s.audio.saveChunk(job.id,job.epoch,0,'controlled text',mp3(),s.at);s.audio.finish(job.id,job.epoch,{jobId:job.id,status:'ready',chunks:[{...chunk,status:'ready'}],error:null},s.at);
 expect(s.audio.create(s.owner,s.session.id,'controlled-read-known-cache',request,voice,s.at).status).toBe('completed');expect(s.assets.readAsset(chunk.assetId,s.owner,s.at).bytes).toEqual(mp3());
 expect(()=>s.audio.create(s.owner,s.session.id,'controlled-revision-bypass',request,{...voice,providerVersion:'controlled_fixture_v2'},s.at)).toThrow();
});
it('single-flights a cache key, binds voice and publishes only owned stored chunk ids',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};
 const one=s.audio.create(s.owner,s.session.id,'controlled-audio-a',request,voice,s.at),two=s.audio.create(s.owner,s.session.id,'controlled-audio-b',request,voice,s.at);expect(two.id).toBe(one.id);
 const job=s.store.claim(s.at)!;const chunk=s.audio.saveChunk(job.id,job.epoch,0,'controlled text',mp3(),s.at);
 expect(()=>s.audio.finish(job.id,job.epoch,{jobId:job.id,status:'ready',chunks:[{index:0,assetId:randomUUID(),status:'ready'}],error:null},s.at)).toThrow();
 s.audio.finish(job.id,job.epoch,{jobId:job.id,status:'ready',chunks:[{...chunk,status:'ready'}],error:null},s.at);
 expect(s.audio.manifest(job.id,s.owner).status).toBe('ready');expect(()=>s.audio.manifest(job.id,randomUUID())).toThrow();
 expect(s.assets.readAsset(chunk.assetId,s.owner,s.at).bytes).toEqual(mp3());
 expect(()=>s.audio.create(s.owner,s.session.id,'controlled-voice-change',{...request,voiceId:'different'},{...voice,id:'different'},s.at)).toThrow();
});
it('retains ready chunks on cancellation and reuses them only after an explicit new retry action',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};const one=s.audio.create(s.owner,s.session.id,'controlled-audio-a',request,voice,s.at),job=s.store.claim(s.at)!;
 const chunk=s.audio.saveChunk(job.id,job.epoch,0,'controlled text',mp3(),s.at);s.store.cancel(job.id,s.owner,s.at);
 expect(()=>s.audio.saveChunk(job.id,job.epoch,1,'late',mp3(),s.at)).toThrow();
 expect(s.audio.create(s.owner,s.session.id,'controlled-audio-a',request,voice,s.at).status).toBe('cancelled');
 const retry=s.audio.create(s.owner,s.session.id,'controlled-explicit-retry',request,voice,s.at);expect(retry.id).toBe(one.id);expect(retry.status).toBe('queued');
 const next=s.store.claim(s.at)!;expect(s.audio.cached(next.id,0,'controlled text',s.owner,s.at)?.assetId).toBe(chunk.assetId);
});
it('applies normal interaction admission limits to repeated explicit retries of one failed audio job',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};
 s.audio.create(s.owner,s.session.id,'controlled-audio-a',request,voice,s.at);let job=s.store.claim(s.at)!;s.store.fail(job.id,job.epoch,'CONTROLLED_FAILURE',s.at);
 for(let i=0;i<8;i++){s.audio.create(s.owner,s.session.id,'controlled-retry-'+i,request,voice,s.at);job=s.store.claim(s.at)!;s.store.fail(job.id,job.epoch,'CONTROLLED_FAILURE',s.at);}
 expect(()=>s.audio.create(s.owner,s.session.id,'controlled-rate-over',request,voice,s.at)).toThrow();
});
it('expires a seven-day audio cache without a paid read or silent regeneration',()=>{
 const s=setup(),request={segmentId:s.session.segments[0]!.id,voiceId:voice.id,speed:0 as const};
 s.audio.create(s.owner,s.session.id,'controlled-audio-a',request,voice,s.at);const job=s.store.claim(s.at)!,chunk=s.audio.saveChunk(job.id,job.epoch,0,'controlled text',mp3(),s.at);
 s.audio.finish(job.id,job.epoch,{jobId:job.id,status:'ready',chunks:[{...chunk,status:'ready'}],error:null},s.at);
 const future=new Date(Date.parse(s.at)+8*86400000).toISOString(),end=new Date(Date.parse(s.at)+9*86400000).toISOString();
 const session=JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as {payload_json:string}).payload_json);s.db.prepare('UPDATE sessions SET payload_json=? WHERE id=?').run(JSON.stringify({...session,expiresAt:end}),s.owner);
 const store=new ExperienceStore(s.db,end),audio=new ExperienceAudio(store,s.assets);
 expect(audio.manifest(job.id,s.owner,future).status).toBe('partial');expect(audio.manifest(job.id,s.owner,future).chunks).toHaveLength(0);
 expect(audio.create(s.owner,s.session.id,'controlled-audio-a',request,voice,future).status).toBe('partial');
 expect(audio.create(s.owner,s.session.id,'controlled-new-after-expiry',request,voice,future).status).toBe('queued');
});

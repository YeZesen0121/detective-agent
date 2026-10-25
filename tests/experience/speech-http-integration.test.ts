import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/server/app.js';
import { readSnapshot } from '../../src/server/platform/snapshots.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { createExperienceModule } from '../../src/server/companion/module.js';
import { SPEECH_SPLIT_VERSION } from '../../src/server/companion/speech.js';
import type { ExperienceRuntimeOptions } from '../../src/server/platform/experience-ports.js';
import { experienceSeed, experienceDraft, experienceFunds } from '../helpers/experience.js';

// controlled_fixture: real P HTTP/SQLite/assets/gateway + E speech; no external transport or playable audio claim.
const closes:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of closes.splice(0))await close();});
const origin='http://127.0.0.1:5173';
function setup(options:{failSecond?:boolean;gate?:Promise<void>;storageFault?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'controlled-e-speech-')),s=experienceSeed(join(root,'state.db'));
 const session=s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at),job=s.store.claim(s.at)!,draft=experienceDraft(s);
 draft.segments[0]!.text='尚未确认延期，仅限广州校区。'.repeat(12);s.store.finishCompanion(job.id,job.epoch,draft,s.at);
 const segmentId=draft.segments[0]!.id,voice={id:'controlled_voice',provider:'tencent-tts' as const,voiceType:123456789,revision:'controlled_fixture_not_real_voice',available:true as const};
 const stats={calls:0,authorizations:0};
 const module=createExperienceModule(async(input,signal)=>{
  signal.throwIfAborted();const current=s.store.assertContext(input.context,new Date().toISOString());
  if(current.kind!=='audio'||current.companionId!==input.companionSessionId||current.resultVersionId!==input.resultVersionId||current.request.segmentId!==input.segmentId||current.request.text!==input.text||current.request.voiceId!==input.voiceId)throw Error('controlled authorization refused');
  const version=readSnapshot(s.db,current.resultVersionId,current.sessionId)!;const companion=s.store.companion(current.companionId,current.sessionId).session;
  stats.authorizations++;return{ownerSessionId:current.sessionId,accessGroup:input.context.accessGroup,version,companion,voice};
 });
 const runtime:ExperienceRuntimeOptions={module,providers:{model:async()=>{throw Error('unexpected model call');},tts:async(input)=>{
  stats.calls++;if(options.gate)await options.gate;if(options.failSecond&&stats.calls===2)throw Error('controlled_fixture second provider failure');
  return{audioBytes:new Uint8Array([255,251,144,100,1,2,3,4]),contentType:'audio/mpeg',providerRequestId:'controlled_fixture_'+stats.calls,billedCharacters:[...input.text].length,usage:null};
 }},pricing:{quote:()=>({provider:'controlled_fixture',purpose:'controlled_fixture',attemptNo:1,priceRevision:'controlled_fixture-v1',timeoutMs:1000,estimated:{...zeroAmounts(),moneyMicros:10}}),actual:()=>({...zeroAmounts(),moneyMicros:10})},
 funding:{global:experienceFunds,trial:experienceFunds,demo:experienceFunds},voices:[{id:voice.id,label:'controlled_fixture',available:true}],ttsProviderVersion:voice.revision,splitVersion:SPEECH_SPLIT_VERSION};
 const configuration={databasePath:join(root,'state.db'),privateStorageRoot:join(root,'private'),allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:s.ends,secureCookies:false,experienceRuntime:runtime};
 let app=buildApp(configuration);
 if(options.storageFault)s.db.exec("CREATE TRIGGER controlled_storage_failure BEFORE INSERT ON private_assets WHEN NEW.kind='audio' BEGIN SELECT RAISE(ABORT,'controlled_fixture storage failure'); END");
 closes.push(async()=>{await app.close();s.db.close();rmSync(root,{recursive:true,force:true});});
 const cookie='detective_session='+s.token,headers={origin,cookie},url='/api/v1/companions/'+session.id+'/audio';
 const post=(key:string)=>app.inject({method:'POST',url,headers:{...headers,'idempotency-key':key},payload:{segmentId,voiceId:voice.id,speed:0}});
 const get=(url:string)=>app.inject({url,headers:{cookie}});
 async function until(id:string){for(let i=0;i<200;i++){const response=await get('/api/v1/audio-jobs/'+id),value=response.json().data;if(['ready','partial','failed','cancelled'].includes(value?.status))return value;await new Promise<void>(r=>setImmediate(r));}throw Error('controlled speech not finished');}
 return{...s,get app(){return app;},post,get,until,headers,cookie,session,segmentId,stats,restart:async()=>{await app.close();app=buildApp(configuration);await app.ready();}};
}
it('persists actual E chunks single-flight, serves private Range and rejects another browser session',async()=>{
 const s=setup(),[a,b]=await Promise.all([s.post('controlled-speech-a'),s.post('controlled-speech-b')]);expect(a.statusCode).toBe(202);expect(b.statusCode).toBe(202);
 const id=a.json().data.audioJobId;expect(b.json().data.audioJobId).toBe(id);const result=await s.until(id);
 expect(result.status).toBe('ready');expect(result.chunks.length).toBeGreaterThan(1);expect(s.stats.calls).toBe(result.chunks.length);expect(s.stats.authorizations).toBe(1);
 const assetId=result.chunks[0].assetId,content=await s.app.inject({url:'/api/v1/audio-assets/'+assetId,headers:{cookie:s.cookie,range:'bytes=0-3'}});
 expect(content.statusCode).toBe(206);expect(content.rawPayload).toEqual(Buffer.from([255,251,144,100]));expect(content.headers['cache-control']).toContain('private');expect(JSON.stringify(result)).not.toMatch(/storageKey|audioBytes|private[\\/]/);
 await s.post('controlled-speech-c');expect(s.stats.calls).toBe(result.chunks.length);
 const other=await s.app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}}),foreign=String(other.headers['set-cookie']).split(';')[0]!;
 for(const url of ['/api/v1/audio-jobs/'+id,'/api/v1/audio-assets/'+assetId])expect((await s.app.inject({url,headers:{cookie:foreign,range:'bytes=0-3'}})).statusCode).toBe(404);
});
it('publishes no fake ready asset when the real platform save transaction fails',async()=>{
 const s=setup({storageFault:true}),start=await s.post('controlled-save-failure'),result=await s.until(start.json().data.audioJobId);
 expect(result.status).toBe('failed');expect(result.chunks).toEqual([]);expect(s.stats.calls).toBe(1);expect(s.db.prepare("SELECT count(*) n FROM private_assets WHERE kind='audio'").get()).toMatchObject({n:0});
});
it('keeps the first chunk and retries only missing chunks after explicit reconciliation and continuation',async()=>{
 const s=setup({failSecond:true}),start=await s.post('controlled-partial-first'),id=start.json().data.audioJobId,partial=await s.until(id);
 expect(partial.status).toBe('partial');expect(partial.chunks).toHaveLength(1);expect(s.stats.calls).toBe(2);
 expect((await s.post('controlled-partial-first')).json().data.audioJobId).toBe(id);expect(s.stats.calls).toBe(2);
 // controlled_fixture reconciliation: assert the simulated failed call's known charge, never release unknown as free.
 const calls=s.db.prepare("SELECT call_id FROM usage_ledger WHERE operation='tts' AND status='unknown'").all() as Array<{call_id:string}>;
 for(const call of calls)s.book.settle(call.call_id,{...zeroAmounts(),moneyMicros:10},'controlled_fixture_reconciled');
 const attempts=s.db.prepare("SELECT id,characters FROM experience_tts_attempts WHERE status='unknown'").all() as Array<{id:string;characters:number}>;
 for(const attempt of attempts)s.store.settleCharacters(attempt.id,attempt.characters);
 const retry=await s.post('controlled-partial-explicit');expect(retry.statusCode).toBe(202);const ready=await s.until(id);expect(ready.status).toBe('ready');expect(ready.chunks[0].assetId).toBe(partial.chunks[0].assetId);expect(s.stats.calls).toBe(ready.chunks.length+1);
});
it('rejects continuation before unknown requests have been reconciled',async()=>{
 const s=setup({failSecond:true}),start=await s.post('controlled-unknown-first'),id=start.json().data.audioJobId;await s.until(id);
 const retry=await s.post('controlled-unknown-retry');expect(retry.statusCode).toBe(409);expect(s.stats.calls).toBe(2);
});
it('cancels a late actual E speech chunk, publishes no asset and still settles its known cost',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),s=setup({gate});
 try{
  const start=await s.post('controlled-cancel-speech'),id=start.json().data.audioJobId;for(let i=0;i<200&&s.stats.calls===0;i++)await new Promise<void>(r=>setImmediate(r));expect(s.stats.calls).toBe(1);
  const cancel=await s.app.inject({method:'POST',url:'/api/v1/audio-jobs/'+id+'/cancel',headers:s.headers});expect(cancel.json().data.status).toBe('cancelled');release();await s.app.close();
  expect(s.db.prepare("SELECT count(*) n FROM audio_chunks").get()).toMatchObject({n:0});expect(s.db.prepare("SELECT status FROM usage_ledger WHERE operation='tts'").get()).toMatchObject({status:'settled'});
 }finally{release();}
});
it('reopens persisted E audio without charging again or restoring a serialized speech plan',async()=>{
 const s=setup(),start=await s.post('controlled-restart-first'),id=start.json().data.audioJobId,before=await s.until(id),calls=s.stats.calls;
 await s.restart();const after=(await s.get('/api/v1/audio-jobs/'+id)).json().data;expect(after).toEqual(before);
 const replay=await s.post('controlled-restart-new-key');expect(replay.json().data.audioJobId).toBe(id);expect(s.stats.calls).toBe(calls);expect(s.stats.authorizations).toBe(1);
 const chunk=await s.app.inject({url:'/api/v1/audio-assets/'+after.chunks[0].assetId,headers:{cookie:s.cookie,range:'bytes=-4'}});expect(chunk.statusCode).toBe(206);expect(chunk.rawPayload.byteLength).toBe(4);
});

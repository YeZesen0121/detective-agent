import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/server/app.js';
import { buildCompanion, answerCompanion } from '../../src/server/companion/briefing.js';
import { extractAttachments } from '../../src/server/attachments/extract.js';
import { createSpeechSynthesizer as createESpeechSynthesizer } from '../../src/server/companion/speech-persistent.js';
import type { ExperienceRuntimeOptions } from '../../src/server/platform/experience-ports.js';
import { listenLoopback } from '../helpers/loopback-http.js';
import { experienceFunds, experienceSeed } from '../helpers/experience.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const fn of close.splice(0))await fn();});
const origin='http://127.0.0.1:5173';
const compatibleSpeechFactory:NonNullable<ExperienceRuntimeOptions['createSpeechSynthesizer']>=createESpeechSynthesizer;
function setup(options:{modelGate?:Promise<void>;ttsGate?:Promise<void>;repairOutputs?:boolean;turnPromptVersion?:'experience.turn.v1'|'experience.turn.v2';audioTerminal?:'failed'|'cancelled';ttsChildSignal?:AbortSignal;speechFactory?:boolean;missingSpeechVoice?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'controlled-experience-http-')),databasePath=join(root,'state.db'),s=experienceSeed(databasePath),stats={model:0,tts:0,ttsAborted:false,authorizations:0};
 const trustedVoice={id:'controlled_voice',provider:'tencent-tts' as const,voiceType:123456789,revision:'controlled_fixture_not_real_voice',available:true as const};
 const module={buildCompanion,answerCompanion,extractAttachments,synthesizeSegment:async(input:any,services:any,signal:AbortSignal)=>{
  if(options.audioTerminal)return{jobId:services.audio.jobId,status:options.audioTerminal,chunks:[],error:options.audioTerminal==='failed'?'SPEECH_INVALID_AUDIO':'SPEECH_ABORTED'};
  const chunks=[];for(let start=0,index=0;start<input.text.length;start+=150,index++){
   const receipt=await services.tts({text:input.text.slice(start,start+150),voiceId:input.voiceId,speed:0,codec:'mp3'},input.context,options.ttsChildSignal??signal);
   chunks.push({...await services.audio.saveChunk(index,receipt),status:'ready'});
  }return{jobId:services.audio.jobId,status:'ready',chunks,error:null};
 }};
 if(options.turnPromptVersion)module.answerCompanion=(input,services,signal)=>answerCompanion(input,{...services,
  model:(request,context,abort)=>services.model({...request,promptVersion:options.turnPromptVersion!},context,abort)},signal);
 if(options.repairOutputs)module.buildCompanion=async(input,services,signal)=>{
  const request={purpose:'companion' as const,promptVersion:'controlled_fixture',schemaId:'controlled_fixture',messages:[{role:'user' as const,content:'controlled_fixture'}],maxOutputTokens:1500};
  const first=await services.model(request,input.context,signal);await services.model(request,input.context,signal);
  return{resultVersionId:input.version.id,personaVersion:input.persona.version,...first.value as any};
 };
 const providers={model:async(input:any)=>{stats.model++;if(options.modelGate)await options.modelGate;
  const response=input.schemaId==='experience.companion.reply.v1'?{kind:'answer',text:'controlled_fixture 仅基于已存公告，条件仍保留。',claimIds:[s.payload.claims[0]!.id],evidenceIds:[s.payload.evidence[0]!.id],resumeCursor:1}:
   {summary:'controlled_fixture 讲解',segments:Array.from({length:3},(_,i)=>({id:randomUUID(),text:'controlled_fixture 第'+i+'段，仅依据这份公告，未知保留。',action:null,claimIds:[s.payload.claims[0]!.id],evidenceIds:[s.payload.evidence[0]!.id]}))};
  return{value:response,usage:{inputTokens:50,outputTokens:options.repairOutputs?1500:20,characters:0,searches:0,reads:0},providerRequestId:'controlled_model',modelId:'controlled_fixture',finishReason:'stop'};
 },tts:async(input:any,_context:any,signal:AbortSignal)=>{stats.tts++;signal.addEventListener('abort',()=>{stats.ttsAborted=true;},{once:true});if(options.ttsGate)await options.ttsGate;return{audioBytes:Buffer.concat([Buffer.from([255,251,144,100]),Buffer.alloc(413)]),contentType:'audio/mpeg',providerRequestId:'controlled_tts',billedCharacters:[...input.text].length,usage:null};}};
 const pricing={quote:(op:string,input:any)=>({provider:'controlled_fixture',purpose:'controlled_fixture',attemptNo:1,priceRevision:'controlled_fixture-v1',timeoutMs:1000,estimated:{...zeroAmounts(),moneyMicros:op==='model'?10:20,...(op==='model'?{modelCalls:1,inputTokens:Buffer.byteLength(JSON.stringify(input.messages),'utf8')+512,outputTokens:input.maxOutputTokens}:{})}}),actual:(op:string,response:any)=>({...zeroAmounts(),moneyMicros:op==='model'?10:20,...(op==='model'?{modelCalls:1,inputTokens:response.usage.inputTokens,outputTokens:response.usage.outputTokens}:{})})};
 const app=buildApp({databasePath,allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:s.ends,secureCookies:false,privateStorageRoot:join(root,'assets'),
  experienceRuntime:{module,providers,pricing,funding:{global:experienceFunds,trial:experienceFunds,demo:experienceFunds},voices:[{id:'controlled_voice',label:'controlled_fixture 音色',available:true}],ttsProviderVersion:'controlled_fixture-v1',splitVersion:'sentences-v1',
   ...(options.speechFactory?{speechVoices:options.missingSpeechVoice?[]:[trustedVoice],createSpeechSynthesizer:(resolveAuthorized:any)=>compatibleSpeechFactory(async(input,signal)=>{
    const binding=await resolveAuthorized(input,signal);expect(binding).toMatchObject({ownerSessionId:s.owner,version:{id:s.version.id},voice:trustedVoice});stats.authorizations++;
    return binding;
   })}:{})}} as any);
 close.push(async()=>{await app.close();s.db.close();rmSync(root,{recursive:true,force:true});});
 const cookie='detective_session='+s.token,headers={origin,cookie,'idempotency-key':'controlled-create'};
 async function get(url:string){return app.inject({url,headers:{cookie}});}
 async function until(url:string,field:'session'|'audio'|'turn'='session'){
  for(let i=0;i<100;i++){const r=await get(url);const value=r.json().data;if(field==='session'?value?.session.status==='ready':field==='audio'?['ready','partial','failed','cancelled'].includes(value?.status):['completed','failed'].includes(value?.status))return value;await new Promise<void>(resolve=>setImmediate(resolve));}throw Error('controlled experience did not finish');
 }
 return{...s,app,stats,cookie,headers,get,until,databasePath,privateStorageRoot:join(root,'assets')};
}
it.each([undefined,'experience.turn.v1','experience.turn.v2'] as const)('runs actual E text modules over HTTP (prompt override %s), persists cursor and shares the case budget across questions',async turnPromptVersion=>{
 const s=setup(turnPromptVersion?{turnPromptVersion}:{}),url='/api/v1/results/'+s.version.id+'/companions';
 const post=()=>s.app.inject({method:'POST',url,headers:s.headers,payload:{personaId:'default'}});
 const [a,b]=await Promise.all([post(),post()]);expect(a.statusCode).toBe(202);const id=a.json().data.companionSessionId;expect(b.json().data.companionSessionId).toBe(id);
 const view=await s.until('/api/v1/companions/'+id);expect(view.session.resultVersionId).toBe(s.version.id);expect(s.stats.model).toBe(1);
 const patch=await s.app.inject({method:'PATCH',url:'/api/v1/companions/'+id,headers:s.headers,payload:{cursor:2}});expect(patch.json().data.cursor).toBe(2);
 const asked=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/turns',headers:{...s.headers,'idempotency-key':'controlled-question'},payload:{question:'controlled_fixture 哪些未知仍保留？'}});expect(asked.statusCode).toBe(202);
 const answer=await s.until('/api/v1/companions/'+id+'/turns/'+asked.json().data.turnId,'turn');expect(answer.reply.kind).toBe('answer');expect(answer.newRunId).toBeNull();
 const pool=s.db.prepare("SELECT used_json FROM budget_pools WHERE kind='interaction'").get() as {used_json:string};expect(JSON.parse(pool.used_json).modelCalls).toBe(2);
 const budget=await s.get('/api/v1/investigations/'+s.investigationId+'/interaction-budget');expect(budget.statusCode).toBe(200);expect(budget.json().data.snapshot.used.modelCalls).toBe(2);
 const other=await s.app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}});const foreign=String(other.headers['set-cookie']).split(';')[0]!;
 expect((await s.app.inject({url:'/api/v1/companions/'+id,headers:{cookie:foreign}})).statusCode).toBe(404);
});
it('recovers accepted HTTP actions without repeating their POSTs or paid calls',async()=>{
 const s=setup({speechFactory:true});
 const start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}});
 expect(start.statusCode).toBe(202); // Simulate losing this body: discover only by persisted key.
 const recover=async(operation:string,key:string)=>{
  const r=await s.app.inject({url:'/api/v1/investigations/'+s.investigationId+'/media-submission?operation='+operation,headers:{cookie:s.cookie,'idempotency-key':key}});
  expect(r.statusCode).toBe(200);return r.json().data.submission;
 };
 const companion=await recover('companion','controlled-create'),id=companion.companionSessionId,view=await s.until('/api/v1/companions/'+id);
 const turn=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/turns',headers:{...s.headers,'idempotency-key':'controlled-lost-turn'},payload:{question:'controlled_fixture 什么仍未知？'}});
 expect(turn.statusCode).toBe(202);const question=await recover('turn','controlled-lost-turn');
 expect((await s.until('/api/v1/companions/'+id+'/turns/'+question.turnId,'turn')).status).toBe('completed');
 const audio=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':'controlled-lost-audio'},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}});
 expect(audio.statusCode).toBe(202);const recording=await recover('audio','controlled-lost-audio');
 expect((await s.until('/api/v1/audio-jobs/'+recording.audioJobId,'audio')).status).toBe('ready');
 const counts={...s.stats};
 for(let i=0;i<3;i++){await recover('companion','controlled-create');await recover('turn','controlled-lost-turn');await recover('audio','controlled-lost-audio');}
 expect(s.stats).toEqual(counts);expect(s.stats).toMatchObject({model:2,tts:1});
 const history=await s.get('/api/v1/companions/'+id+'/turns');
 expect(history.json().data.items[0]).toMatchObject({turnId:question.turnId,question:'controlled_fixture 什么仍未知？',view:{status:'completed',reply:{kind:'answer'},newRunId:null}});
});
it('single-flights actual audio jobs, serves authorized byte ranges, and rejects client-supplied speech',async()=>{
 const s=setup(),started=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=started.json().data.companionSessionId;
 const view=await s.until('/api/v1/companions/'+id),segmentId=view.session.segments[0].id;
 const request={segmentId,voiceId:'controlled_voice',speed:0};const url='/api/v1/companions/'+id+'/audio';
 const [one,two]=await Promise.all(['controlled-audio-a','controlled-audio-b'].map(key=>s.app.inject({method:'POST',url,headers:{...s.headers,'idempotency-key':key},payload:request})));
 expect(one!.statusCode).toBe(202);const jobId=one!.json().data.audioJobId;expect(two!.json().data.audioJobId).toBe(jobId);
 const manifest=await s.until('/api/v1/audio-jobs/'+jobId,'audio');expect(manifest.status).toBe('ready');expect(s.stats.tts).toBe(1);
 const asset=manifest.chunks[0].assetId;const partial=await s.app.inject({url:'/api/v1/audio-assets/'+asset,headers:{cookie:s.cookie,range:'bytes=0-3'}});
 expect(partial.statusCode).toBe(206);expect(partial.rawPayload).toEqual(Buffer.from([255,251,144,100]));expect(partial.headers['cache-control']).toContain('private');
 expect((await s.app.inject({url:'/api/v1/audio-assets/'+asset,headers:{cookie:s.cookie,range:'bytes=9000-'}})).statusCode).toBe(416);
 expect((await s.app.inject({method:'POST',url,headers:{...s.headers,'idempotency-key':'controlled-forged-text'},payload:{...request,text:'不能传任意朗读文字'}})).statusCode).toBe(400);
});
it('injects a server-only speech resolver and persists the exact trusted voice before its first paid call',async()=>{
 const s=setup({speechFactory:true}),start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId,view=await s.until('/api/v1/companions/'+id);
 const accepted=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':'controlled-factory-audio'},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}}),jobId=accepted.json().data.audioJobId;
 expect(accepted.statusCode).toBe(202);expect((await s.until('/api/v1/audio-jobs/'+jobId,'audio')).status).toBe('ready');expect(s.stats.authorizations).toBe(1);expect(s.stats.tts).toBe(1);
 const row=s.db.prepare('SELECT request_json FROM experience_jobs WHERE id=?').get(jobId) as {request_json:string};expect(JSON.parse(row.request_json).voiceBinding).toMatchObject({provider:'tencent-tts',voiceType:123456789,revision:'controlled_fixture_not_real_voice'});
 const voices=await s.get('/api/v1/voices');expect(voices.json().data.items).toHaveLength(1);expect(voices.body).not.toMatch(/voiceType|revision|tencent/);
});
it('advertises no usable audio and sends no TTS when a factory has no trusted voice mapping',async()=>{
 const s=setup({speechFactory:true,missingSpeechVoice:true}),start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId,view=await s.until('/api/v1/companions/'+id);
 expect((await s.get('/health/ready')).json().data.capabilities).not.toContain('audio');expect((await s.get('/api/v1/voices')).json().data.items).toEqual([]);
 const request=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':'controlled-factory-unconfigured'},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}});expect(request.statusCode).toBe(503);expect(s.stats.tts).toBe(0);
});
it('does not send a second model reservation beyond the per-request cumulative 2000 output budget',async()=>{
 const s=setup({repairOutputs:true}),start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId;
 let view:any;for(let i=0;i<100;i++){view=(await s.get('/api/v1/companions/'+id)).json().data;if(['ready','failed'].includes(view.session.status))break;await new Promise<void>(r=>setImmediate(r));}
 expect(s.stats.model).toBe(1);expect(view.session.status).toBe('failed');
});
it.each(['failed','cancelled'] as const)('persists a legal factory %s manifest through HTTP with its safe speech code',async audioTerminal=>{
 const s=setup({audioTerminal}),start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId,view=await s.until('/api/v1/companions/'+id);
 const accepted=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':'controlled-terminal-audio'},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}});
 const result=await s.until('/api/v1/audio-jobs/'+accepted.json().data.audioJobId,'audio');expect(result).toMatchObject({status:audioTerminal,chunks:[],error:audioTerminal==='failed'?'SPEECH_INVALID_AUDIO':'SPEECH_ABORTED'});expect(s.stats.tts).toBe(0);
});
it('propagates a speech child abort to the paid transport, holds unknown cost and blocks retry until reconciled',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),controller=new AbortController(),s=setup({ttsGate:gate,ttsChildSignal:controller.signal});
 try{
  const start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId,view=await s.until('/api/v1/companions/'+id);
  const post=(key:string)=>s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':key},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}});
  const first=await post('controlled-child-abort'),jobId=first.json().data.audioJobId;for(let i=0;s.stats.tts===0&&i<100;i++)await new Promise<void>(r=>setImmediate(r));expect(s.stats.tts).toBe(1);
  controller.abort();expect(s.stats.ttsAborted).toBe(true);const failed=await s.until('/api/v1/audio-jobs/'+jobId,'audio');expect(failed.chunks).toEqual([]);
  expect(s.db.prepare("SELECT status FROM usage_ledger WHERE operation='tts'").get()).toMatchObject({status:'unknown'});expect(s.db.prepare('SELECT status FROM experience_tts_attempts').get()).toMatchObject({status:'unknown'});
  expect((await post('controlled-child-abort-new-key')).statusCode).toBe(409);expect(s.stats.tts).toBe(1);
  release();await s.app.close();expect(s.db.prepare("SELECT status FROM usage_ledger WHERE operation='tts'").get()).toMatchObject({status:'settled'});expect(s.db.prepare('SELECT status FROM experience_tts_attempts').get()).toMatchObject({status:'settled'});
 }finally{release();}
});
it('cancels a late speech response without publishing its asset while still settling its known cost',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),s=setup({ttsGate:gate});
 try{
  const start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId,view=await s.until('/api/v1/companions/'+id);
  const audio=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':'controlled-late-audio'},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}}),jobId=audio.json().data.audioJobId;
  for(let i=0;s.stats.tts===0&&i<100;i++)await new Promise<void>(r=>setImmediate(r));expect(s.stats.tts).toBe(1);
  const cancelled=await s.app.inject({method:'POST',url:'/api/v1/audio-jobs/'+jobId+'/cancel',headers:s.headers});expect(cancelled.json().data.status).toBe('cancelled');release();await s.app.close();
  expect(s.db.prepare("SELECT count(*) n FROM private_assets WHERE kind='audio'").get()).toMatchObject({n:0});
  expect(s.db.prepare("SELECT status FROM usage_ledger WHERE operation='tts'").get()).toMatchObject({status:'settled'});
  expect(s.db.prepare("SELECT status,call_id FROM experience_tts_attempts").get()).toMatchObject({status:'settled',call_id:expect.any(String)});
 }finally{release();}
});
it('reopens stored companion/audio through real HTTP with generation disabled and preserves private ranges',async()=>{
 const s=setup(),start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}}),id=start.json().data.companionSessionId,view=await s.until('/api/v1/companions/'+id);
 await s.app.inject({method:'PATCH',url:'/api/v1/companions/'+id,headers:s.headers,payload:{cursor:2}});
 const audio=await s.app.inject({method:'POST',url:'/api/v1/companions/'+id+'/audio',headers:{...s.headers,'idempotency-key':'controlled-reopen-audio'},payload:{segmentId:view.session.segments[0].id,voiceId:'controlled_voice',speed:0}}),jobId=audio.json().data.audioJobId,manifest=await s.until('/api/v1/audio-jobs/'+jobId,'audio');
 await s.app.close();const count={...s.stats};
 const restored=buildApp({databasePath:s.databasePath,privateStorageRoot:s.privateStorageRoot,allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:s.ends,secureCookies:false});
 try{
  const address=await listenLoopback(restored);const response=await fetch(address+'/api/v1/companions/'+id,{headers:{cookie:s.cookie}});expect((await response.json()).data.session.cursor).toBe(2);
  const chunk=await fetch(address+'/api/v1/audio-assets/'+manifest.chunks[0].assetId,{headers:{cookie:s.cookie,range:'bytes=-4'}});expect(chunk.status).toBe(206);expect((await chunk.arrayBuffer()).byteLength).toBe(4);
  const off=await fetch(address+'/api/v1/results/'+s.version.id+'/companions',{method:'POST',headers:{...s.headers,'content-type':'application/json'},body:JSON.stringify({personaId:'default'})});expect(off.status).toBe(503);
  expect(s.stats).toEqual(count);
 }finally{await restored.close();}
});
it('marks a crash snapshot of a sent model request unknown even when reopened without a runtime',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),s=setup({modelGate:gate}),backup=s.databasePath+'.restart-copy';
 let id:string;
 try{
  const start=await s.app.inject({method:'POST',url:'/api/v1/results/'+s.version.id+'/companions',headers:s.headers,payload:{personaId:'default'}});id=start.json().data.companionSessionId;
  for(let i=0;s.stats.model===0&&i<100;i++)await new Promise<void>(r=>setImmediate(r));expect(s.stats.model).toBe(1);
  await s.db.backup(backup);
 }finally{release();await s.app.close();}
 const restored=buildApp({databasePath:backup,privateStorageRoot:s.privateStorageRoot,allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:s.ends,secureCookies:false});
 try{
  await restored.ready();const db=(await import('../../src/server/platform/database.js')).openDatabase(backup);
  try{expect(db.prepare("SELECT status FROM usage_ledger WHERE operation='model'").get()).toMatchObject({status:'unknown'});expect((await restored.inject({url:'/api/v1/companions/'+id!,headers:{cookie:s.cookie}})).json().data.session.status).toBe('failed');}
  finally{db.close();}
  expect(s.stats.model).toBe(1);
 }finally{await restored.close();}
});

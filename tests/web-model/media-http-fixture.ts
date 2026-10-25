import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildApp } from '../../src/server/app.js';
import { buildCompanion, answerCompanion } from '../../src/server/companion/briefing.js';
import { extractAttachments } from '../../src/server/attachments/extract.js';
import { createSpeechSynthesizer } from '../../src/server/companion/speech-persistent.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { experienceFunds } from '../helpers/experience.js';
import type { ExperienceRuntimeOptions } from '../../src/server/platform/experience-ports.js';
import { runtimeSeed } from '../helpers/runtime.js';
import { ExperienceStore } from '../../src/server/platform/experience-store.js';
import { sha256 } from '../../src/server/platform/repository.js';
import type { InvestigationModule } from '../../src/shared/ports.js';

function seedMedia(path: string,longMaterial=false,unclaimedMaterial=false,sourceOnly=false) {
 const s=runtimeSeed(path),at=s.run.startedAt!,ends=new Date(Date.now()+86400000).toISOString(),token='controlled_fixture_token';
 const session=JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as {payload_json:string}).payload_json);
 s.db.prepare('UPDATE sessions SET token_hash=?,payload_json=? WHERE id=?').run(sha256(token),JSON.stringify({...session,tokenHash:sha256(token),expiresAt:ends}),s.owner);
 s.payload.conditions=Array.from({length:10},(_,i)=>`controlled_fixture 条件 ${i+1}：仅用于本地工程验证，不是真实调查结论`);
 if(longMaterial){const url='https://example.invalid/'+('controlled_fixture_long_path_'.repeat(12));s.payload.sources[0]!.url=url;s.payload.sources[0]!.canonicalUrl=url;s.payload.sources[0]!.title=url;s.payload.evidence[0]!.excerpt=('controlled_fixture 长引用：报名截止日期仍需核对。').repeat(32);}
 if(unclaimedMaterial){s.payload.claims=[];s.payload.answerBlocks=[];s.payload.summary='controlled_fixture 尚未形成可核验命题';s.payload.unknowns=['controlled_fixture 材料仍未核验'];s.payload.stopReason='no_useful_direction';s.payload.evidence[0]!.limitations=['capture_context_risk：controlled_fixture 背景仍待核对'];s.payload.evidence.push({...s.payload.evidence[0]!,id:randomUUID(),excerpt:'controlled_fixture 不重复显示的原始存档',limitations:['raw_capture_only：原始捕获存档']});}
 if(sourceOnly){s.payload.claims=[];s.payload.answerBlocks=[];s.payload.evidence=[];s.payload.summary='controlled_fixture 仅找到搜索摘要。停止原因：provider_error';s.payload.unknowns=['controlled_fixture 原文读取仍未确认'];s.payload.stopReason='provider_error';s.payload.sources[0]!.readStatus='snippet_only';s.payload.sources[0]!.snippet='controlled_fixture 搜索摘要，尚未核验';s.payload.sources[0]!.diagnostic='controlled_fixture 原文读取timeout，结果unknown';}
 s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,at);s.runs.saveCheckpoint(s.run.id,s.run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},at);
 const version=s.runs.commitResult(s.run.id,s.run.epoch,s.payload,unclaimedMaterial||sourceOnly?'partial':'completed',at);
 for(const name of ['global','trial','demo'] as const)s.book.createPool({id:'runtime:'+name,kind:name==='global'?'global':'access_group',accessGroup:name==='global'?null:name,sessionId:null,investigationId:null,limits:experienceFunds});
 return {...s,version,at,ends,token,store:new ExperienceStore(s.db,ends)};
}

// controlled_fixture only. Real HTTP, host, gateway, SQLite, private assets and E
// modules. The injected providers are deterministic; no external transport exists.
export async function serveMedia(worker:number,{configured=true,playable=false,ttsGate,followupModule,companionResearch=false,longMaterial=false,audioAvailable=true,unclaimedMaterial=false,sourceOnly=false,visionReady=false}:{configured?:boolean;playable?:boolean;ttsGate?:Promise<void>;followupModule?:InvestigationModule;companionResearch?:boolean;longMaterial?:boolean;audioAvailable?:boolean;unclaimedMaterial?:boolean;sourceOnly?:boolean;visionReady?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'controlled-w-media-'));const databasePath=join(root,'state.db'),seed=seedMedia(databasePath,longMaterial,unclaimedMaterial,sourceOnly);
 const investigation=JSON.parse((seed.db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(seed.investigationId) as {payload_json:string}).payload_json);seed.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify({...investigation,presentationMode:'companion'}),seed.investigationId);
 const port=32760+worker,site=`http://127.0.0.1:${port}`,calls={model:0,tts:0,real:0},requests:Array<{method:string;url:string;key:string|null}>=[];
 let audio=Buffer.concat(Array.from({length:40},()=>Buffer.concat([Buffer.from([255,251,144,100]),Buffer.alloc(413)])));
 if(playable){const generated=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.7','-ar','44100','-ac','1','-b:a','64k','-write_xing','0','-id3v2_version','0','-f','mp3','pipe:1'],{windowsHide:true});if(generated.status!==0)throw Error('controlled_fixture playable tone requires installed ffmpeg');audio=generated.stdout;}
 const runtime:ExperienceRuntimeOptions={module:{buildCompanion,answerCompanion,extractAttachments},createSpeechSynthesizer,
  providers:{model:async request=>{calls.model++;const turn=request.promptVersion.includes('turn');return{value:request.schemaId==='experience.extraction.v1'?{visibleText:'controlled_fixture 图中文字',speakerClues:[],visibleDates:[],claimSuggestions:[],uncertainSpans:[],warnings:[]}:turn?{kind:companionResearch?'research_request':'answer',text:'controlled_fixture 回答：仍需核对，保留未知。',claimIds:[seed.payload.claims[0]!.id],evidenceIds:[seed.payload.evidence[0]!.id],resumeCursor:1,followupQuestion:companionResearch?'controlled_fixture research from companion':null}:{summary:'controlled_fixture 伴读摘要',segments:[0,1,2].map((_,i)=>({id:randomUUID(),text:`controlled_fixture 第${i+1}段。仅以已存材料为准，未知仍保留。`.repeat(i===0?7:1),action:null,claimIds:[seed.payload.claims[0]!.id],evidenceIds:[seed.payload.evidence[0]!.id]}))},usage:{inputTokens:30,outputTokens:100,characters:0,searches:0,reads:0},providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'};},
   tts:async input=>{calls.tts++;if(ttsGate)await ttsGate;return{audioBytes:audio,contentType:'audio/mpeg',providerRequestId:'controlled_fixture_tone',billedCharacters:[...input.text].length,usage:null};}},
  pricing:{quote:(op,input)=>({provider:'controlled_fixture',purpose:'controlled_fixture',attemptNo:1,priceRevision:'controlled_fixture',timeoutMs:5000,estimated:{...zeroAmounts(),moneyMicros:1,...(op==='model'?{modelCalls:1,inputTokens:Buffer.byteLength(JSON.stringify(input))+512,outputTokens:'maxOutputTokens'in input?input.maxOutputTokens:0}:{})}}),actual:(op)=>({...zeroAmounts(),moneyMicros:1,...(op==='model'?{modelCalls:1,inputTokens:30,outputTokens:100}:{})})},
  funding:{global:experienceFunds,trial:experienceFunds,demo:experienceFunds},voices:['controlled_voice','controlled_voice_b'].map(id=>({id,label:'controlled_fixture 提示音 '+id,available:true})),speechVoices:['controlled_voice','controlled_voice_b'].map(id=>({id,provider:'tencent-tts',voiceType:123456789,revision:'controlled_fixture_not_real_voice',available:true})),ttsProviderVersion:'controlled_fixture',splitVersion:'sentences-v1'};
 if(!audioAvailable){runtime.voices=[];runtime.speechVoices=[];}
 if(visionReady)runtime.pricing.visionInputTokens=images=>images.length*200;
 const forbidden=async()=>{calls.real++;throw Error('controlled_fixture forbids real providers');};
 const app=buildApp({databasePath,privateStorageRoot:join(root,'assets'),allowedOrigin:site,trialCode:'controlled-media-trial',demoCode:'controlled-media-demo',serviceEndsAt:seed.ends,secureCookies:false,webRoot:resolve('dist/web'),...(configured?{experienceRuntime:runtime}:{}),...(followupModule?{investigationRuntime:{module:followupModule,supportsAttachments:visionReady,enableFollowups:true,enableWatches:false,providers:{search:forbidden,read:forbidden,model:forbidden},funding:{global:experienceFunds,trial:experienceFunds,demo:experienceFunds},pricing:{quote:()=>({provider:'controlled_fixture',purpose:'controlled_fixture',priceRevision:'controlled_fixture',attemptNo:1,timeoutMs:5000,estimated:{...zeroAmounts(),moneyMicros:1}}),actual:()=>null}}}:{})});
 app.addHook('onRequest',async request=>{if(request.url.startsWith('/api/v1/'))requests.push({method:request.method,url:request.url,key:typeof request.headers['idempotency-key']==='string'?request.headers['idempotency-key']:null});});
 await app.listen({host:'127.0.0.1',port});
 return{site,seed,app,calls,requests,publishUpdate(){
  const at=new Date().toISOString(),windowId=randomUUID();seed.book.createPool({id:windowId,kind:'window',sessionId:seed.owner,investigationId:seed.investigationId,accessGroup:'trial',limits:experienceFunds});
  seed.runs.enqueue({sessionId:seed.owner,investigationId:seed.investigationId,key:'controlled-update',action:'add_budget',previousRunId:seed.run.id,budgetWindowId:windowId,at});const run=seed.runs.claimNext(at)!;
  const payload={...seed.payload,runId:run.id,summary:'controlled_fixture 新报告，旧版仍保留',delta:{previousVersionId:seed.version.id,changes:[],checkedAt:at}};
  seed.runs.setScope(run.id,run.epoch,payload.scope,at);seed.runs.saveCheckpoint(run.id,run.epoch,{sources:payload.sources,evidence:payload.evidence,claims:payload.claims},at);
  return seed.runs.commitResult(run.id,run.epoch,payload,'completed',at);
 },async close(){await app.close();seed.db.close();if(dirname(resolve(root))!==resolve(tmpdir())||!basename(root).startsWith('controlled-w-media-'))throw Error('Unsafe fixture cleanup');rmSync(root,{recursive:true,force:true});}};
}

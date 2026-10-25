import { ExtractionInputSchema,ModelRequestSchema,ModelResponseSchema,TTSRequestSchema,TTSResponseSchema,type ExperienceServices,type TTSResponse,type InvestigationServices } from '../../shared/ports.js';
import type { InvocationContext } from '../../shared/contracts.js';
import { ApiFault, BudgetLimitFault } from './errors.js';
import { hashValue } from './snapshots.js';
import { byteHash, type PrivateAssets } from './private-assets.js';
import type { ExperienceRuntimeOptions, ImageMetadata } from './experience-ports.js';
import type { PaidGateway } from './gateway.js';
import type { ExperienceJob, ExperienceStore } from './experience-store.js';
import type { ExperienceAudio } from './experience-audio.js';
import { ProviderModelTraces } from './model-traces.js';
export function bindExperienceServices(options:{runtime:ExperienceRuntimeOptions;gateway:PaidGateway;store:ExperienceStore;assets:PrivateAssets;audio:ExperienceAudio;
 context:InvocationContext;job?:ExperienceJob;signal:AbortSignal;now():string;assertCurrent():void;onFailure(error:unknown):void;runCore?:InvestigationServices}):{services:ExperienceServices;audioCovered():boolean}{
 const {runtime,gateway,store,assets,audio,job,signal,now}=options;
 const context=Object.freeze({...options.context}),contextHash=hashValue(context);
 const modelTrace=new ProviderModelTraces(store.db).observer();
 let modelAttempts=0,outputRemaining=2000,ttsIndex=0,ttsOffset=0,pendingReceipts=0;
 const receipts=new WeakMap<TTSResponse,{index:number;text:string;hash:string}>();
 function guard(ctx=context){if(hashValue(ctx)!==contextHash)throw new ApiFault(409,'INVALID_STATE','业务模块不能更改平台上下文。');signal.throwIfAborted();options.assertCurrent();}
 const unavailable=async()=>{throw new ApiFault(409,'INVALID_STATE','伴读不写调查材料或伪造调查进度。');};
 const services:ExperienceServices={
  clock:{now},budget:{snapshot:async ctx=>{guard(ctx);return store.book.snapshot(context,['runtime:global','runtime:'+context.accessGroup,(context.interactionPoolId??context.budgetWindowId)!]);}},
  checkpoint:options.runCore?.checkpoint??{save:unavailable},events:options.runCore?.events??{append:unavailable},
  model:async(raw,ctx,childSignal)=>{
   const callSignal=AbortSignal.any([signal,childSignal]);guard(ctx);callSignal.throwIfAborted();
   // Accepted E code passes its typed extraction descriptor (which also has dimensions/order).
   // Project that exact validated descriptor; arbitrary extra fields still fail the strict model schema.
   const input=ModelRequestSchema.parse({...raw,messages:raw.messages.map(message=>({...message,...(message.attachmentRefs?{attachmentRefs:message.attachmentRefs.map(ref=>{
    const full=ExtractionInputSchema.shape.attachments.element.safeParse(ref);return full.success?{id:full.data.id,mime:full.data.mime,bytesRef:full.data.bytesRef}:ref;
   })}:{})}))});
   if(job?.kind==='audio')throw new ApiFault(409,'INVALID_STATE','语音生成不能改写已保存段落。');
   if(job&&(input.purpose!=='companion'||input.maxOutputTokens>outputRemaining||++modelAttempts>2))throw new BudgetLimitFault(input.maxOutputTokens>outputRemaining?'outputTokens':'modelCalls');
   if(job)outputRemaining-=input.maxOutputTokens;
   if(!job&&input.purpose!=='extract')throw new ApiFault(409,'INVALID_STATE','截图步骤只能提取图中线索。');
   const refs=input.messages.flatMap(m=>m.attachmentRefs??[]);if(new Set(refs.map(r=>r.id)).size!==refs.length)throw new ApiFault(400,'VALIDATION_ERROR','图片引用重复。');
   const images=refs.map(ref=>assets.resolveImage(ref,context.sessionId,context.investigationId));
   if(job&&images.length)throw new ApiFault(409,'INVALID_STATE','伴读只使用固定报告材料。');
   const metadata:ImageMetadata[]=images.map(({bytes:_bytes,...m})=>m);
   const inputBytes=Buffer.byteLength(JSON.stringify(input.messages),'utf8');
   if(inputBytes+images.reduce((n,i)=>n+Math.ceil(i.bytes.length/3)*4,0)>40*1024*1024)throw new ApiFault(400,'VALIDATION_ERROR','模型图片请求过大。');
   const imageBound=images.length?runtime.pricing.visionInputTokens?.(metadata):0;
   if(imageBound===undefined||!Number.isSafeInteger(imageBound)||imageBound<0||images.length&&imageBound===0)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','视觉用量上界尚未配置。');
   const quote=runtime.pricing.quote('model',input,metadata);
   if(quote.estimated.inputTokens<inputBytes+imageBound||quote.estimated.outputTokens<input.maxOutputTokens)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','模型用量预留不足。');
   try{
    const result=await gateway.invoke(context,{...quote,operation:'model'},async(abort,callId)=>{modelTrace.sent?.('model',input,callId);const value=ModelResponseSchema.parse(await runtime.providers.model(input,context,abort,images));modelTrace.received?.('model',value,callId);if(value.finishReason!=='stop')throw new ApiFault(503,'PROVIDER_UNAVAILABLE','模型返回未完整结束。');return{value,actual:runtime.pricing.actual('model',value),...(value.providerRequestId?{providerRequestId:value.providerRequestId}:{})};},callSignal);
    guard();callSignal.throwIfAborted();if(job&&result.value.usage&&result.value.usage.outputTokens>0)outputRemaining+=Math.max(0,input.maxOutputTokens-result.value.usage.outputTokens);return result.value;
   }catch(error){options.onFailure(error);throw error;}
  },
  tts:async(raw,ctx,childSignal)=>{
   const callSignal=AbortSignal.any([signal,childSignal]);guard(ctx);callSignal.throwIfAborted();if(!job||job.kind!=='audio'||!runtime.providers.tts)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','语音服务尚未配置。');
   const input=TTSRequestSchema.parse(raw),text=String(job.request.text);
   while(ttsOffset<text.length&&/\s/.test(text[ttsOffset]!))ttsOffset++;
   if(input.voiceId!==job.request.voiceId||!text.slice(ttsOffset).startsWith(input.text))throw new ApiFault(409,'INVALID_STATE','只能朗读已保存段落的连续文字。');
   ttsOffset+=input.text.length;const index=ttsIndex++;const cached=audio.cached(job.id,index,input.text,job.sessionId,now());
   if(cached){const value:TTSResponse={audioBytes:cached.bytes,contentType:'audio/mpeg',providerRequestId:null,billedCharacters:0,usage:null};receipts.set(value,{index,text:input.text,hash:byteHash(value.audioBytes)});pendingReceipts++;return value;}
   const token=store.reserveCharacters(job.id,job.epoch,input.text.length,{index,requestHash:hashValue(input),at:now()});
   try{
    const quote=runtime.pricing.quote('tts',input);
    const result=await gateway.invoke(context,{...quote,operation:'tts'},async(abort,callId)=>{
     store.markCharactersSent(token,callId);const value=TTSResponseSchema.parse(await runtime.providers.tts!(input,context,abort));
     store.settleCharacters(token,value.billedCharacters);return{value,actual:runtime.pricing.actual('tts',value),...(value.providerRequestId?{providerRequestId:value.providerRequestId}:{})};
    },callSignal);
    guard();callSignal.throwIfAborted();receipts.set(result.value,{index,text:input.text,hash:byteHash(result.value.audioBytes)});pendingReceipts++;return result.value;
   }catch(error){store.settleCharacters(token,null);options.onFailure(error);throw error;}
  },
 };
 if(job?.kind==='audio')services.audio={jobId:job.id,saveChunk:async(index,receipt)=>{
  guard();const recorded=receipts.get(receipt);if(!recorded||recorded.index!==index||recorded.hash!==byteHash(receipt.audioBytes))throw new ApiFault(409,'INVALID_STATE','音频必须来自本次已授权的原始语音回执。');
  const saved=audio.saveChunk(job.id,job.epoch,index,recorded.text,Buffer.from(receipt.audioBytes),now());receipts.delete(receipt);pendingReceipts--;return saved;
 }};
 // Host validates that the module did not declare ready before covering the saved paragraph.
 return {services,audioCovered:()=>!!job&&ttsIndex>0&&String(job.request.text).slice(ttsOffset).trim().length===0&&pendingReceipts===0};
}

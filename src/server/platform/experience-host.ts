import { z } from 'zod';
import { AudioManifestSchema, type InvocationContext } from '../../shared/contracts.js';
import { CompanionDraftSchema, CompanionReplySchema, ExtractionBatchSchema, ExtractionInputSchema, type ExperienceModule, type InvestigationServices } from '../../shared/ports.js';
import { CompanionPatchSchema, RequestAudioSchema, TurnViewSchema, VoicesSchema } from '../../shared/experience-http.js';
import { ApiFault, BudgetLimitFault } from './errors.js';
import { DEFAULT_PERSONA, ExperienceStore, type ExperienceJob } from './experience-store.js';
import { ExperienceAudio } from './experience-audio.js';
import { bindExperienceServices } from './experience-services.js';
import { ensureRuntimeFunding } from './runtime-funding.js';
import { readSnapshot } from './snapshots.js';
import { SpeechVoiceBindingSchema, type ExperienceRuntimeOptions, type SpeechVoiceBinding } from './experience-ports.js';
import { createSpeechAuthorizationResolver } from './speech-authorization.js';
import type { PrivateAssets } from './private-assets.js';
import type { PaidGateway } from './gateway.js';
export class ExperienceHost {
 private closed=false;private recovered=false;private scheduled:NodeJS.Immediate|null=null;
 private readonly active=new Map<string,{controller:AbortController;task:Promise<void>}>();
 readonly audio:ExperienceAudio;
 private readonly speechVoices:readonly SpeechVoiceBinding[];
 private readonly synthesize:ExperienceModule['synthesizeSegment']|undefined;
 constructor(readonly store:ExperienceStore,readonly assets:PrivateAssets,readonly gateway:PaidGateway,readonly options:ExperienceRuntimeOptions,readonly now:()=>string){
  ensureRuntimeFunding(store.db,options.funding);this.audio=new ExperienceAudio(store,assets);VoicesSchema.parse({items:options.voices??[]});
  this.speechVoices=Object.freeze((options.speechVoices??[]).map(voice=>Object.freeze(SpeechVoiceBindingSchema.parse(voice))));
  const resolveAuthorized=createSpeechAuthorizationResolver(store,this.speechVoices,now);
  this.synthesize=options.createSpeechSynthesizer?options.createSpeechSynthesizer(resolveAuthorized):options.module.synthesizeSegment;
 }
 assertContext(ctx:InvocationContext){return this.store.assertContext(ctx,this.now());}
 wake(){this.kick();}
 async extractForRun(context:InvocationContext,core:InvestigationServices,signal:AbortSignal,assertCurrent:()=>void){
  const pending=this.assets.list(context.investigationId,context.sessionId).filter(a=>!a.extraction);
  if(pending.length){
   const controller=new AbortController(),abort=()=>controller.abort(signal.reason);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
   try{
    const binding=bindExperienceServices({runtime:this.options,gateway:this.gateway,store:this.store,assets:this.assets,audio:this.audio,context,signal:controller.signal,now:this.now,assertCurrent,onFailure:error=>controller.abort(error),runCore:core});
    const input=ExtractionInputSchema.parse({context,attachments:pending.map(a=>({id:a.id,mime:a.mime,bytesRef:this.assets.bytesRef(a),order:a.order,width:a.width,height:a.height}))});
    const batch=ExtractionBatchSchema.parse(await this.options.module.extractAttachments(input,binding.services,controller.signal));
    signal.throwIfAborted();assertCurrent();const returned=[...batch.items.map(a=>a.attachmentId),...batch.failed.map(a=>a.attachmentId)];
    if(returned.length!==pending.length||returned.some(id=>!pending.some(a=>a.id===id)))throw new ApiFault(409,'INVALID_STATE','图像提取没有逐一对应输入附件。');
    this.store.db.transaction(()=>{assertCurrent();for(const item of batch.items)this.assets.saveExtraction(item.attachmentId,context.sessionId,item,batch.blockingQuestions);for(const item of batch.failed)this.assets.saveExtraction(item.attachmentId,context.sessionId,null,[],true);}).immediate();
   }finally{signal.removeEventListener('abort',abort);}
  }
  const all=this.assets.list(context.investigationId,context.sessionId),items=all.flatMap(a=>a.extraction?[a.extraction]:[]),failed=all.filter(a=>a.status==='failed').map(a=>({attachmentId:a.id,errorCode:'EXTRACTION_FAILED'}));
  if(!items.length&&failed.length)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','截图提取未完成，已保留原图。');
  return ExtractionBatchSchema.parse({items,failed,blockingQuestions:this.assets.questions(context.investigationId,context.sessionId)});
 }
 async recover(){if(this.recovered)return;this.store.recover(this.now());this.store.book.recoverInFlight();this.recovered=true;}
 private ready(owner:string){if(this.closed||!this.recovered)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','伴读宿主尚未就绪。');this.store.session(owner,this.now());}
 startCompanion(owner:string,version:string,key:string){this.ready(owner);const session=this.store.createCompanion(owner,version,key,this.now());this.kick();return session;}
 startTurn(owner:string,id:string,key:string,question:string){this.ready(owner);const job=this.store.createTurn(owner,id,key,question,this.now());this.kick();return job;}
 patch(id:string,owner:string,input:z.infer<typeof CompanionPatchSchema>){const patched=this.store.patchCompanion(id,owner,input,this.now());if(input.ended)for(const [jobId,entry]of this.active){if(this.store.job(jobId)?.companionId===id)entry.controller.abort();}return patched;}
 voices(){return(this.options.voices??[]).filter(v=>v.available&&(!this.options.createSpeechSynthesizer||this.speechVoices.some(voice=>voice.id===v.id)));}
 supportsAudio(){return!!(this.synthesize&&this.options.providers.tts&&this.options.ttsProviderVersion&&this.options.splitVersion&&this.voices().length);}
 startAudio(owner:string,id:string,key:string,raw:z.infer<typeof RequestAudioSchema>){
  this.ready(owner);const request=RequestAudioSchema.parse(raw);
  if(!this.supportsAudio())throw new ApiFault(503,'PROVIDER_UNAVAILABLE','语音模块、音色或计价尚未接入。');
  if(!this.voices().some(v=>v.id===request.voiceId))throw new ApiFault(400,'VALIDATION_ERROR','请选择已配置可用的音色。');
  const binding=this.speechVoices.find(voice=>voice.id===request.voiceId);
  const job=this.audio.create(owner,id,key,request,{id:request.voiceId,providerVersion:this.options.ttsProviderVersion!,splitVersion:this.options.splitVersion!,...(binding?{binding}:{})},this.now());this.kick();return job;
 }
 cancelAudio(owner:string,id:string){const job=this.store.job(id,owner);if(!job||job.kind!=='audio')throw new ApiFault(404,'NOT_FOUND','未找到该音频任务。');this.store.cancel(id,owner,this.now());this.active.get(id)?.controller.abort();return this.audio.manifest(id,owner);}
 turn(id:string,companionId:string,owner:string){const job=this.store.job(id,owner);if(!job||job.kind!=='turn'||job.companionId!==companionId)throw new ApiFault(404,'NOT_FOUND','未找到该问答。');
  return TurnViewSchema.parse({status:job.status,reply:job.output?CompanionReplySchema.parse(job.output):null,newRunId:null,error:job.errorCode?{code:job.errorCode,message:'本次问答未完成，已保留原报告。'}:null});}
 private kick(){if(this.closed||this.scheduled)return;this.scheduled=setImmediate(()=>{this.scheduled=null;if(this.closed)return;
  while(this.active.size<2){const job=this.store.claim(this.now());if(!job)break;const controller=new AbortController();const task=Promise.resolve().then(()=>this.execute(job,controller)).finally(()=>{this.active.delete(job.id);this.kick();});this.active.set(job.id,{controller,task});void task.catch(()=>{});}
 });}
 private async execute(job:ExperienceJob,controller:AbortController){
  let timer:NodeJS.Timeout|undefined;let stopListener:(()=>void)|undefined;
  try{
   const context=Object.freeze(this.store.context(job.id,this.now()));this.assertContext(context);
   if(!this.store.book.unrestricted){timer=setTimeout(()=>controller.abort(new BudgetLimitFault('activeMs')),Math.max(1,Date.parse(context.deadlineAt)-Date.parse(this.now())));timer.unref();}
   const binding=bindExperienceServices({runtime:this.options,gateway:this.gateway,store:this.store,assets:this.assets,audio:this.audio,context,job,signal:controller.signal,now:this.now,
    assertCurrent:()=>this.assertContext(context),onFailure:error=>controller.abort(error)});
   const version=readSnapshot(this.store.db,job.resultVersionId,job.sessionId);if(!version)throw new ApiFault(404,'NOT_FOUND','原报告不存在。');
   const stopped=new Promise<never>((_resolve,reject)=>{stopListener=()=>reject(controller.signal.reason??new ApiFault(409,'INVALID_STATE','交互任务已停止。'));controller.signal.addEventListener('abort',stopListener,{once:true});if(controller.signal.aborted)stopListener();});
   const work=Promise.resolve().then(async()=>{
    if(job.kind==='companion')return this.options.module.buildCompanion({context,version,persona:DEFAULT_PERSONA},binding.services,controller.signal);
    if(job.kind==='turn')return this.options.module.answerCompanion({context,session:this.store.companion(job.companionId,job.sessionId).session,version,question:String(job.request.question)},binding.services,controller.signal);
    if(!this.synthesize)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','语音模块未接入。');
    return this.synthesize({context,resultVersionId:job.resultVersionId,companionSessionId:job.companionId,segmentId:String(job.request.segmentId),text:String(job.request.text),voiceId:String(job.request.voiceId),speed:0},binding.services,controller.signal);
   });
   const result=await Promise.race([work,stopped]);controller.signal.throwIfAborted();this.assertContext(context);
   if(job.kind==='companion')this.store.finishCompanion(job.id,job.epoch,CompanionDraftSchema.parse(result),this.now());
   else if(job.kind==='turn')this.store.finishTurn(job.id,job.epoch,CompanionReplySchema.parse(result),this.now());
   else {const manifest=AudioManifestSchema.parse(result);if(manifest.status==='ready'&&!binding.audioCovered())throw new ApiFault(409,'INVALID_STATE','音频没有完整覆盖已保存段落。');this.audio.finish(job.id,job.epoch,manifest,this.now());}
  }catch(error){const current=this.store.job(job.id);if(current?.status==='running'&&current.epoch===job.epoch){
   try{this.store.fail(job.id,job.epoch,error instanceof z.ZodError?'INVALID_OUTPUT':error instanceof ApiFault?error.code:'PROVIDER_ERROR',this.now());}catch{/* startup/shutdown may already have fenced the worker */}
  }}finally{if(timer)clearTimeout(timer);if(stopListener)controller.signal.removeEventListener('abort',stopListener);}
 }
 async close(){if(this.closed)return;this.closed=true;if(this.scheduled)clearImmediate(this.scheduled);this.store.recover(this.now());for(const item of this.active.values())item.controller.abort();await Promise.allSettled([...this.active.values()].map(item=>item.task));}
}

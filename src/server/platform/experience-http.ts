import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IdSchema } from '../../shared/contracts.js';
import { AudioAcceptedSchema, AudioViewSchema, CompanionAcceptedSchema, CompanionPatchSchema, CompanionQuestionSchema, CompanionViewSchema, InteractionBudgetViewSchema, RequestAudioSchema, StartCompanionSchema, TurnAcceptedSchema, TurnViewSchema, VoicesSchema } from '../../shared/experience-http.js';
import { ApiFault } from './errors.js';
import type { ExperienceHost } from './experience-host.js';
import type { ExperienceStore } from './experience-store.js';
import { ExperienceAudio } from './experience-audio.js';
import { sendPrivateBinary, type HttpDependencies } from './private-http.js';
import type { PrivateAssets } from './private-assets.js';
export function registerExperienceRoutes(app:FastifyInstance,store:ExperienceStore,assets:PrivateAssets,host:ExperienceHost|null,deps:HttpDependencies){
 const {requireSession,envelope,now}=deps,audio=new ExperienceAudio(store,assets);
 const id=(request:FastifyRequest)=>z.strictObject({id:IdSchema}).parse(request.params).id;
 const key=(request:FastifyRequest)=>z.string().min(8).max(128).parse(request.headers['idempotency-key']);
 const requireHost=()=>{if(!host)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','伴读模块与计价尚未配置。');return host;};
 app.get('/api/v1/investigations/:id/interaction-budget',async request=>envelope(request,InteractionBudgetViewSchema.parse({configured:!!host,...store.budget(requireSession(request).id,id(request),now())})));
 app.post('/api/v1/results/:id/companions',async(request,reply)=>{const owner=requireSession(request).id;StartCompanionSchema.parse(request.body);const session=requireHost().startCompanion(owner,id(request),key(request));return reply.code(202).send(envelope(request,CompanionAcceptedSchema.parse({companionSessionId:session.id,status:session.status})));});
 app.get('/api/v1/companions/:id',async request=>envelope(request,CompanionViewSchema.parse(store.companion(id(request),requireSession(request).id))));
 app.patch('/api/v1/companions/:id',async request=>{const owner=requireSession(request).id,patch=CompanionPatchSchema.parse(request.body);return envelope(request,host?host.patch(id(request),owner,patch):store.patchCompanion(id(request),owner,patch,now()));});
 app.post('/api/v1/companions/:id/turns',async(request,reply)=>{const owner=requireSession(request).id,input=CompanionQuestionSchema.parse(request.body);const job=requireHost().startTurn(owner,id(request),key(request),input.question);return reply.code(202).send(envelope(request,TurnAcceptedSchema.parse({turnId:job.id})));});
 app.get('/api/v1/companions/:id/turns/:turnId',async request=>{const owner=requireSession(request).id,p=z.strictObject({id:IdSchema,turnId:IdSchema}).parse(request.params);
  if(host)return envelope(request,host.turn(p.turnId,p.id,owner));const job=store.job(p.turnId,owner);if(!job||job.kind!=='turn'||job.companionId!==p.id)throw new ApiFault(404,'NOT_FOUND','未找到该问答。');return envelope(request,TurnViewSchema.parse({status:job.status,reply:job.output,newRunId:null,error:job.errorCode?{code:job.errorCode,message:'问答未完成。'}:null}));
 });
 app.get('/api/v1/voices',async request=>{requireSession(request);return envelope(request,VoicesSchema.parse({items:host?.voices()??[]}));});
 app.post('/api/v1/companions/:id/audio',async(request,reply)=>{const owner=requireSession(request).id,input=RequestAudioSchema.parse(request.body),job=requireHost().startAudio(owner,id(request),key(request),input);return reply.code(202).send(envelope(request,AudioAcceptedSchema.parse({audioJobId:job.id})));});
 app.get('/api/v1/audio-jobs/:id',async request=>envelope(request,AudioViewSchema.parse(audio.manifest(id(request),requireSession(request).id))));
 app.post('/api/v1/audio-jobs/:id/cancel',async(request,reply)=>{const owner=requireSession(request).id,job=store.job(id(request),owner);if(!job||job.kind!=='audio')throw new ApiFault(404,'NOT_FOUND','未找到该音频任务。');const value=host?host.cancelAudio(owner,job.id):(store.cancel(job.id,owner,now()),audio.manifest(job.id,owner));return reply.code(202).send(envelope(request,AudioViewSchema.parse(value)));});
 app.get('/api/v1/audio-assets/:id',async(request,reply)=>{const owner=requireSession(request).id,asset=assets.readAsset(id(request),owner,now());if(asset.kind!=='audio')throw new ApiFault(404,'NOT_FOUND','未找到该音频。');return sendPrivateBinary(reply,asset,z.string().max(256).optional().parse(request.headers.range),z.string().max(256).optional().parse(request.headers['if-range']));});
}

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SpeechError } from './companion/speech-errors.js';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { z } from 'zod';
import {
  CONTRACT_VERSION, CreateInvestigationSchema, IdSchema, InvestigationPublicSchema, TimestampSchema, WatchPublicSchema, NotificationPublicSchema,
} from '../shared/contracts.js';
import { FoundationStore, sha256 } from './platform/repository.js';
import { ApiFault } from './platform/errors.js';
import { openDatabase } from './platform/database.js';
import { InvestigationHost, RESEARCH_LIMITS, type InvestigationRuntimeOptions } from './platform/host.js';
import { RunStore } from './platform/runs.js';
import multipart from '@fastify/multipart';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { PrivateAssets } from './platform/private-assets.js';
import { registerAttachmentRoutes } from './platform/private-http.js';
import { ExperienceStore } from './platform/experience-store.js';
import { ExperienceHost } from './platform/experience-host.js';
import { registerExperienceRoutes } from './platform/experience-http.js';
import { registerExperienceRecoveryRoutes } from './platform/experience-recovery-http.js';
import type { ExperienceRuntimeOptions } from './platform/experience-ports.js';
import { FollowupStore } from './platform/followup-store.js';
import { FollowupHost } from './platform/followup-host.js';
import { AcceptedFollowupSchema, CreateFollowupSchema, FollowupsPageSchema, FollowupSubmissionSchema } from '../shared/followup-http.js';
import { RuntimeCapabilitiesSchema } from '../shared/capabilities-http.js';
import {newInvestigationAvailability} from './platform/research-availability.js';
import {ListInvestigationsQuerySchema} from '../shared/investigations-http.js';
import {deleteInvestigation} from './platform/case-deletion.js';
import { PaidGateway } from './platform/gateway.js';
import { BudgetBook } from './platform/budget.js';
import type { PaidCampaignPolicy } from './platform/paid-campaign.js';
import { WatchStore } from './platform/watch-store.js';
import { CreateWatchRequestSchema,WatchActionSchema,AcceptedCheckSchema,WatchesSchema,ChecksPageSchema,NotificationsPageSchema,MarkReadSchema } from '../shared/watch-http.js';
import { StartRunSchema, ClarificationAnswerSchema, StartedRunSchema, RunViewSchema, EventsPageSchema,
  ResultViewSchema, CancelledRunSchema, AnsweredRunSchema, CopyResultSchema } from '../shared/runtime-http.js';

export interface FoundationOptions {
  databasePath: string;
  allowedOrigin: string;
  trialCode: string;
  demoCode: string;
  serviceEndsAt: string;
  secureCookies: boolean;
  now?: () => string;
  webRoot?: string;
  investigationRuntime?: InvestigationRuntimeOptions;
  privateStorageRoot?: string;
  experienceRuntime?: ExperienceRuntimeOptions;
  paidCampaign?: PaidCampaignPolicy;
  unrestrictedUsage?: boolean;
}

export const FOUNDATION_LIMITS = RESEARCH_LIMITS;

export function buildApp(options: FoundationOptions) {
  TimestampSchema.parse(options.serviceEndsAt);
  const url = new URL(options.allowedOrigin);
  if (url.origin !== options.allowedOrigin || !['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN must be an HTTP(S) origin');
  if (options.trialCode.length < 12 || options.demoCode.length < 12 || options.trialCode === options.demoCode) throw new Error('Access codes must be distinct and at least 12 characters');
  if (url.protocol === 'https:' && !options.secureCookies) throw new Error('HTTPS requires secure cookies');
  const now = options.now ?? (() => new Date().toISOString());
  const db = openDatabase(options.databasePath);
  let gatewayBook:BudgetBook;
  try { gatewayBook=new BudgetBook(db,options.paidCampaign,options.unrestrictedUsage===undefined?undefined:{unrestricted:options.unrestrictedUsage}); }
  catch(error){db.close();throw error;}
  const ephemeral=options.databasePath===':memory:'&&!options.privateStorageRoot;
  const privateRoot=options.privateStorageRoot??(ephemeral?mkdtempSync(join(tmpdir(),'detective-private-')):join(dirname(resolve(options.databasePath)),'private-assets'));
  const assets=new PrivateAssets(db,privateRoot);
  const store = new FoundationStore(db);
  const runs = new RunStore(db);
  let host: InvestigationHost | null=null;
  let experience:ExperienceHost|null=null;
  let followups:FollowupHost|null=null;
  const followupStore=new FollowupStore(db,options.serviceEndsAt);
  const experienceStore=new ExperienceStore(db,options.serviceEndsAt);
  const gateway=new PaidGateway({book:gatewayBook,concurrency:{search:2,read:2,model:2,tts:1},
    failureDiagnostic:error=>error instanceof SpeechError?error.privateDiagnostic:undefined,
    poolIds:ctx=>ctx.watchCheckId?(host?host.watchStore.poolIds(ctx):[]):['runtime:global','runtime:'+ctx.accessGroup,(ctx.interactionPoolId??ctx.budgetWindowId)!],
    assertCurrent:ctx=>{if(ctx.interactionPoolId){if(followupStore.ownsContext(ctx)){followupStore.assertContext(ctx,now());return;}if(!experience)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','交互宿主未配置。');experience.assertContext(ctx);}else{if(!host)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','调查宿主未配置。');host.assertContext(ctx);}},
  });
  try { host = options.investigationRuntime ? new InvestigationHost(db, { ...options.investigationRuntime, now, serviceEndsAt: options.serviceEndsAt,gateway,assets,
      ...(options.experienceRuntime?.pricing.visionInputTokens?{extractAttachments:(context,core,signal,check)=>{if(!experience)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','视觉宿主未配置。');return experience.extractForRun(context,core,signal,check);}}:{}),
    }) : null;
    experience=options.experienceRuntime?new ExperienceHost(experienceStore,assets,gateway,options.experienceRuntime,now):null;
    followups=options.investigationRuntime?new FollowupHost(followupStore,options.investigationRuntime,gateway,now,owner=>host!.admitFollowup(owner),()=>host?.wake(),()=>experience?.wake()):null;
  }
  catch (error) { db.close(); throw error; }
  const watchStore=host?.watchStore??new WatchStore(db,{serviceEndsAt:options.serviceEndsAt});
  const app = Fastify({ logger: false, bodyLimit: 32768, requestIdHeader: false, genReqId: () => randomUUID() });
  const envelope = <T>(request: FastifyRequest, data: T) => ({ data, meta: { requestId: request.id, contractVersion: CONTRACT_VERSION } });
  const sendFault = (request: FastifyRequest, reply: FastifyReply, fault: ApiFault) => reply.code(fault.status).send({
    error: { code: fault.code, message: fault.message, retryable: fault.retryable },
    meta: { requestId: request.id, contractVersion: CONTRACT_VERSION },
  });
  app.register(cookie);
  app.register(multipart,{limits:{files:1,fields:0,parts:1,fileSize:8*1024*1024}});
  app.addHook('onReady', async () => { assets.collectGarbage(now(),true);if (host) await host.recover();if(experience)await experience.recover();else experienceStore.recover(now());if(followups)followups.recover();else followupStore.recover(now());new BudgetBook(db).recoverInFlight(); });
  app.addHook('onResponse',async()=>{assets.collectGarbage(now());});
  app.addHook('onClose', async () => { await followups?.close();await Promise.all([host?.close(),experience?.close()]);await gateway.drain();db.close();if(ephemeral&&dirname(resolve(privateRoot))===resolve(tmpdir())&&basename(privateRoot).startsWith('detective-private-'))rmSync(privateRoot,{recursive:true,force:true}); });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiFault) return sendFault(request, reply, error);
    if (error instanceof z.ZodError || (error instanceof Error && 'statusCode' in error && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500)) {
      return sendFault(request, reply, new ApiFault(400, 'VALIDATION_ERROR', '请求格式不正确，请检查后重试。'));
    }
    return sendFault(request, reply, new ApiFault(500, 'INTERNAL_ERROR', '服务暂时出现问题，请保留当前输入。'));
  });
  app.setNotFoundHandler((request, reply) => sendFault(request, reply, new ApiFault(404, 'NOT_FOUND', '未找到该资源。')));
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== options.allowedOrigin) {
      throw new ApiFault(400, 'VALIDATION_ERROR', '请求来源无效，请从本站重新操作。');
    }
  });
  const requireSession = (request: FastifyRequest) => {
    const token = request.cookies['detective_session'];
    const session = token ? store.findSession(sha256(token), now()) : null;
    if (!session || Date.parse(now()) >= Date.parse(options.serviceEndsAt)) throw new ApiFault(401, 'UNAUTHENTICATED', '请先输入有效体验码。');
    return session;
  };
  const sessionPublic = (session: { accessGroup: 'trial' | 'demo'; expiresAt: string }) => ({
    accessGroup: session.accessGroup, expiresAt: session.expiresAt, serviceEndsAt: options.serviceEndsAt, limits: FOUNDATION_LIMITS,
  });
  registerAttachmentRoutes(app,assets,{requireSession,envelope,now});
  registerExperienceRoutes(app,experienceStore,assets,experience,{requireSession,envelope,now});
  registerExperienceRecoveryRoutes(app,experienceStore,{requireSession,envelope,now});

  app.get('/health/live', async (request) => envelope(request, { status: 'alive', phase: 'foundation' }));
  app.get('/health/ready', async (request) => {
    store.ready();
    return envelope(request, { status: 'ready', phase: 'foundation', capabilities: ['sessions', 'drafts','attachments',...(experience?['companions',...(experience.supportsAudio()?['audio']:[])]:[]), ...(host ? ['runs', 'events', 'results',...(options.investigationRuntime?.enableWatches===false?[]:['watches','notifications'])] : [])] });
  });
  app.post('/api/v1/sessions', async (request, reply) => {
    const input = z.strictObject({ code: z.string().min(1).max(256) }).parse(request.body);
    const hash = (value: string) => createHash('sha256').update(value).digest();
    const trial = timingSafeEqual(hash(input.code), hash(options.trialCode));
    const demo = timingSafeEqual(hash(input.code), hash(options.demoCode));
    const at = now();
    if ((!trial && !demo) || Date.parse(at) >= Date.parse(options.serviceEndsAt)) throw new ApiFault(401, 'UNAUTHENTICATED', '体验码无效或服务已结束。');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = options.serviceEndsAt;
    const session = store.createSession(sha256(token), demo ? 'demo' : 'trial', at, expiresAt);
    reply.setCookie('detective_session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: options.secureCookies, expires: new Date(expiresAt) });
    return envelope(request, sessionPublic(session));
  });
  app.get('/api/v1/session', async (request) => envelope(request, sessionPublic(requireSession(request))));
  app.get('/api/v1/capabilities',async request=>{
    requireSession(request);
    return envelope(request,RuntimeCapabilitiesSchema.parse({
      basicModes:host?(options.investigationRuntime?.supportedBasicModes??['truth','latest','identify']):[],
      followups:!!host&&options.investigationRuntime?.enableFollowups===true,
      watches:!!host&&options.investigationRuntime?.enableWatches!==false,
      vision:!!host&&options.investigationRuntime?.supportsAttachments===true&&!!options.experienceRuntime?.pricing.visionInputTokens,
      companion:!!experience,audio:experience?.supportsAudio()??false,
      newInvestigations:newInvestigationAvailability(db,!!host,now()),
      ...(gatewayBook.unrestricted?{unrestrictedUsage:true}:{}),
    }));
  });
  app.post('/api/v1/investigations', async (request, reply) => {
    const session = requireSession(request);
    const key = z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    const input = CreateInvestigationSchema.parse(request.body);
    const investigation = store.createDraft(session.id, key, input, now(), options.serviceEndsAt);
    reply.code(201);
    const { sessionId: _owner, ...publicData } = investigation;
    return envelope(request, InvestigationPublicSchema.parse(publicData));
  });
  app.get('/api/v1/investigations',async request=>{
    const session=requireSession(request);
    return envelope(request,store.listInvestigations(session.id,ListInvestigationsQuerySchema.parse(request.query)));
  });
  app.delete('/api/v1/investigations/:id',async request=>{
    const owner=requireSession(request).id;
    const {id}=z.strictObject({id:IdSchema}).parse(request.params);
    return envelope(request,deleteInvestigation(db,owner,id));
  });
  app.get('/api/v1/investigations/:id', async (request) => {
    const session = requireSession(request);
    const { id } = z.strictObject({ id: IdSchema }).parse(request.params);
    const investigation = store.getInvestigation(id, session.id);
    if (!investigation) throw new ApiFault(404, 'NOT_FOUND', '未找到该调查。');
    const { sessionId: _owner, ...publicData } = investigation;
    return envelope(request, { investigation: InvestigationPublicSchema.parse(publicData), activeRun: investigation.activeRunId ? runs.get(investigation.activeRunId, session.id) : null, latestResultVersionId: investigation.latestResultVersionId });
  });
  const requireHost = () => {
    if (!host) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '调查模块与运行预算尚未配置。');
    return host;
  };
  const requireWatchHost=()=>{
    const runtime=requireHost();
    if(options.investigationRuntime?.enableWatches===false)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','当前调查模块尚未接入盯梢事实比较。');
    return runtime;
  };
  const idParam = (request: FastifyRequest) => z.strictObject({ id: IdSchema }).parse(request.params).id;
  app.post('/api/v1/investigations/:id/followups', async (request, reply) => {
    const session=requireSession(request),id=idParam(request);
    if(!store.getInvestigation(id,session.id))throw new ApiFault(404,'NOT_FOUND','未找到该调查。');
    const input=CreateFollowupSchema.parse(request.body),key=z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    if(!followups)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','追问宿主尚未配置。');
    const job=followups.start(session.id,id,key,input);reply.code(202);return envelope(request,AcceptedFollowupSchema.parse({followupTurnId:job.id}));
  });
  app.get('/api/v1/followups/:id',async request=>envelope(request,followupStore.view(idParam(request),requireSession(request).id)));
  app.get('/api/v1/investigations/:id/followups',async request=>{
    const session=requireSession(request),id=idParam(request),query=z.strictObject({after:z.coerce.number().int().nonnegative().default(0)}).parse(request.query);
    return envelope(request,FollowupsPageSchema.parse(followupStore.list(id,session.id,query.after)));
  });
  app.get('/api/v1/investigations/:id/followups/submission',async request=>{
    const session=requireSession(request),id=idParam(request),key=z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    return envelope(request,FollowupSubmissionSchema.parse(followupStore.submission(id,session.id,key)));
  });
  app.post('/api/v1/investigations/:id/runs', async (request, reply) => {
    const session = requireSession(request); const id = idParam(request);
    if (!store.getInvestigation(id, session.id)) throw new ApiFault(404, 'NOT_FOUND', '未找到该调查。');
    const input = StartRunSchema.parse(request.body);
    const key = z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    const run = await requireHost().start(session.id, id, key, input); reply.code(202);
    return envelope(request, StartedRunSchema.parse({ runId: run.id, status: run.status, budgetWindowId: run.budgetWindowId, limits: FOUNDATION_LIMITS }));
  });
  app.get('/api/v1/runs/:id', async request => {
    const session = requireSession(request);
    if (!runs.get(idParam(request), session.id)) throw new ApiFault(404, 'NOT_FOUND', '未找到该任务。');
    return envelope(request, RunViewSchema.parse(requireHost().view(session.id, idParam(request))));
  });
  app.post('/api/v1/runs/:id/cancel', async (request, reply) => {
    const session = requireSession(request); const run = await requireHost().cancel(session.id, idParam(request)); reply.code(202);
    return envelope(request, CancelledRunSchema.parse({ runId: run.id, status: run.status, cancelRequestedAt: run.cancelRequestedAt }));
  });
  app.post('/api/v1/runs/:id/clarifications/:clarificationId', async (request, reply) => {
    const session = requireSession(request);
    const params = z.strictObject({ id: IdSchema, clarificationId: IdSchema }).parse(request.params);
    const run = requireHost().answer(session.id, params.id, params.clarificationId, ClarificationAnswerSchema.parse(request.body)); reply.code(202);
    return envelope(request, AnsweredRunSchema.parse({ runId: run.id, status: run.status }));
  });
  app.get('/api/v1/investigations/:id/events', async request => {
    const session = requireSession(request);
    const query = z.strictObject({ afterSeq: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0) }).parse(request.query);
    return envelope(request, EventsPageSchema.parse(runs.listEvents(idParam(request), session.id, query.afterSeq)));
  });
  app.get('/api/v1/results/:id', async request => {
    const session = requireSession(request); const version = runs.getResult(idParam(request), session.id);
    if (!version) throw new ApiFault(404, 'NOT_FOUND', '未找到该报告。');
    const investigation = store.getInvestigation(version.investigationId, session.id)!;
    const latest = investigation.latestResultVersionId;
    const next = latest && latest !== version.id ? runs.getResult(latest, session.id) : null;
    return envelope(request, ResultViewSchema.parse({ version, updateNotice: next ? { latestResultVersionId: next.id, createdAt: next.createdAt } : null }));
  });
  app.get('/api/v1/results/:id/copy', async request => {
    const session = requireSession(request); const text = runs.copyResult(idParam(request), session.id);
    if (text === null) throw new ApiFault(404, 'NOT_FOUND', '未找到该报告。');
    return envelope(request, CopyResultSchema.parse({ text }));
  });
  const watchPublic=(watch:NonNullable<ReturnType<WatchStore['get']>>)=>{const {sessionId:_owner,...value}=watch;return WatchPublicSchema.parse(value);};
  const notificationPublic=(item:ReturnType<WatchStore['markRead']>)=>{const {sessionId:_owner,...value}=item;return NotificationPublicSchema.parse(value);};
  const cursor=(request:FastifyRequest)=>z.strictObject({cursor:z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0)}).parse(request.query).cursor;
  app.post('/api/v1/watches',async(request,reply)=>{
    const session=requireSession(request),runtime=requireWatchHost();
    const key=z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    const watch=runtime.watchStore.create(session.id,key,CreateWatchRequestSchema.parse(request.body),now());reply.code(201);return envelope(request,watchPublic(watch));
  });
  app.get('/api/v1/watches',async request=>{const session=requireSession(request);return envelope(request,WatchesSchema.parse({items:watchStore.list(session.id).map(watchPublic)}));});
  app.patch('/api/v1/watches/:id',async request=>{const session=requireSession(request);const {action}=WatchActionSchema.parse(request.body);if(action!=='pause')requireWatchHost();return envelope(request,watchPublic(watchStore.change(idParam(request),session.id,action,now())));});
  app.delete('/api/v1/watches/:id',async(request,reply)=>{const session=requireSession(request);watchStore.remove(idParam(request),session.id,now());return reply.code(204).send();});
  app.post('/api/v1/watches/:id/checks',async(request,reply)=>{
    const session=requireSession(request),id=idParam(request),runtime=requireWatchHost();
    const key=z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    const check=runtime.watches.request(session.id,id,key);reply.code(202);return envelope(request,AcceptedCheckSchema.parse({watchCheckId:check.id}));
  });
  app.get('/api/v1/watches/:id/checks',async request=>{const session=requireSession(request);return envelope(request,ChecksPageSchema.parse(watchStore.checks(idParam(request),session.id,cursor(request))));});
  app.get('/api/v1/notifications',async request=>{
    const session=requireSession(request),page=watchStore.notifications(session.id,cursor(request));
    return envelope(request,NotificationsPageSchema.parse({...page,items:page.items.map(notificationPublic)}));
  });
  app.patch('/api/v1/notifications/:id',async request=>{const session=requireSession(request);MarkReadSchema.parse(request.body);return envelope(request,notificationPublic(watchStore.markRead(idParam(request),session.id,now())));});
  if (options.webRoot) app.register(serveStatic, { root: options.webRoot });
  return app;
}

import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createFoundationApi } from '../../src/web/api/foundation.js';
import { createRuntimeApi } from '../../src/web/api/runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { createTruthRuntime } from '../../src/server/platform/truth-runtime.js';
import { listenLoopback } from '../helpers/loopback-http.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaidCampaignPolicy } from '../../src/server/platform/paid-campaign.js';
const apps:ReturnType<typeof buildApp>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
const funding={...zeroAmounts(),activeMs:100000000,searches:1000,reads:1000,modelCalls:1000,inputTokens:10000000,outputTokens:10000000,moneyMicros:100000000};
const origin='http://127.0.0.1:5173';
async function setup(options:{modelGate?:Promise<void>;modelWaitForAbort?:boolean;emptyRead?:boolean;readNetworkFailure?:boolean;sourceCount?:number;authFailure?:boolean;moneyMicros?:number;readLimit?:number;databasePath?:string;cookie?:string;now?:()=>string;port?:number;paidCampaign?:PaidCampaignPolicy;conflictingDeadlines?:boolean}={}) {
 const calls:Array<{path:string;body:any;signal:AbortSignal|null}>=[],responses={review:0},modelStages:string[]=[];let modelEntered!:()=>void;
 const entered=new Promise<void>(r=>{modelEntered=r;});
 const providerFetch:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body));calls.push({path,body,signal:init?.signal??null});
  if(options.authFailure)return Response.json({error:{message:'controlled_fixture: should never be exposed'}},{status:401});
  if(path==='/SearchPro')return Response.json({Response:{Version:'standard',RequestId:'controlled-search',Pages:Array.from({length:options.sourceCount??1},(_,i)=>JSON.stringify({url:'https://example.invalid/notice/'+i,title:'controlled_fixture 公告',passage:'报名截至十月三十日'}))}});
  if(path==='/v1/tools/fetch'){
   if(options.readNetworkFailure)throw Error('controlled_fixture_private_read_failure');
   if(options.conflictingDeadlines)return Response.json({title:'controlled_fixture 同届同人群公告',content:`报名截止2026年10月${String(body.url).endsWith('/1')?'31':'30'}日，仅适用于本科生。`});
   return Response.json({title:'controlled_fixture 公告',content:options.emptyRead?null:'  报名截至十月三十日，仅适用于本科生。  '});
  }
  const stage=modelStages.at(-1);
  const modelResponse=(value:unknown)=>Response.json({id:'controlled-model',model:'deepseek-flash',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}});
  if(stage==='investigation.scope.grounded.v1'){
   const input=JSON.parse(body.messages.find((message:{role:string})=>message.role==='user').content),question=input.question as string,answer=input.answer as string;
   const inputRef=question.includes('controlled_fixture')?'question':'clarification';
   return modelResponse({canLocate:true,object:{text:'controlled_fixture',inputRef,quote:'controlled_fixture'},clues:answer?[{text:answer,inputRef:'clarification',quote:answer,certainty:'known'}]:[],goals:[{kind:'fact',text:question.includes('截止日期')?'核对报名截止日期':question,inputRef:'question',quote:question.includes('截止日期')?'截止日期':question}],resolutions:[]});
  }
  if(stage==='investigation.scope.review.v1'){
   const proposal=JSON.parse(body.messages.at(-1).content).proposal;
   return modelResponse({objectSupported:true,allUserGoalsRepresented:true,clueChecks:proposal.clues.map((_:unknown,clueIndex:number)=>({clueIndex,certainty:'known',reason:'controlled_fixture 原始回答'})),goalChecks:[{goalIndex:0,inScope:true,reason:'controlled_fixture 原始目标'}],criticalChecks:[]});
  }
  modelEntered();if(options.modelWaitForAbort)await new Promise((_resolve,reject)=>{
   const abort=init?.signal;if(abort?.aborted)reject(Error('controlled_fixture aborted'));
   else abort?.addEventListener('abort',()=>reject(Error('controlled_fixture aborted')),{once:true});
  });if(options.modelGate)await options.modelGate;
  const isReview=body.messages.some((message:{content:string})=>message.content.startsWith('复核核心命题'));if(isReview)responses.review++;
  if(options.conflictingDeadlines){
   const statements=['报名截止2026年10月30日','报名截止2026年10月31日'];
   return modelResponse(isReview?{checks:statements.map((_,claimIndex)=>({claimIndex,verdict:'supported',addressesQuestion:true,reason:'controlled_fixture 各自公告支持'})),goalChecks:[{goalIndex:0,claimIndexes:[0,1],covered:true,reason:'controlled_fixture 两个截止命题'}],claimPairChecks:[{leftClaimIndex:0,rightClaimIndex:1,objectText:'controlled_fixture',sameObject:true,sameFactDimension:true,sameConditions:true,relation:'conflicts',left:{evidenceIndex:0,quote:statements[0]},right:{evidenceIndex:1,quote:statements[1]},reason:'controlled_fixture 同届同人群下两个截止值互斥，无撤销或替代依据'}]}:{claims:statements.map((statement,index)=>({statement,status:'supported',evidenceIndexes:[index],conditions:['仅适用于本科生'],gaps:[],reasonSummary:'controlled_fixture 公告直接记载'})),answerBlocks:statements.map((text,index)=>({text,claimIndexes:[index],evidenceIndexes:[index]}))});
  }
  const value=isReview?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:false,reason:'controlled_fixture 截止日期没有回答人人能否报名'}]}:{
   claims:[{statement:'报名截至十月三十日',status:'supported',evidenceIndexes:[0],conditions:['仅适用于本科生'],gaps:[],reasonSummary:'受控公告直接说明'}],
   answerBlocks:[{id:'answer',text:'报名截至十月三十日，仅适用于本科生。',claimIndexes:[0],evidenceIndexes:[0]}],
  };
  return modelResponse(value);
 };
 const funds={...funding,moneyMicros:options.moneyMicros??funding.moneyMicros,reads:options.readLimit??funding.reads};
 const runtime=createTruthRuntime({credentials:{search:{kind:'bearer',apiKey:'controlled_fixture_key'},deepseekKey:'controlled_fixture_key'},funding:{global:funds,trial:funds,demo:funds},
  fetch:providerFetch,resolve:async()=>['203.0.113.10'],now:()=> '2026-10-24T12:00:00.000Z'});
 const searchRequests:Array<Parameters<typeof runtime.providers.search>[0]>=[];
 const search=runtime.providers.search,model=runtime.providers.model;
 runtime.providers.search=async(...args)=>{searchRequests.push(args[0]);return search(...args);};
 runtime.providers.model=async(...args)=>{modelStages.push(args[0].schemaId);return model(...args);};
 const app=buildApp({databasePath:options.databasePath??':memory:',allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:new Date(Date.now()+86400000).toISOString(),secureCookies:false,investigationRuntime:runtime,...(options.now?{now:options.now}:{}),...(options.paidCampaign?{paidCampaign:options.paidCampaign}:{})});
 apps.push(app);const address=await listenLoopback(app,options.port?()=>options.port!:undefined);
 function browser(initialCookie='') {
  let cookie=initialCookie;
  const transport:typeof fetch=async(path,init)=>{
   const headers=new Headers(init?.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);
   // This Node fixture repeatedly destroys servers and reuses ports. Do not reuse the global
   // fetch pool's socket from an earlier server generation, and never retry a POST to mask it.
   headers.set('connection','close');
   let response:Response;
   try{response=await fetch(new URL(String(path),address),{...init,headers});}
   catch(error){if(!init?.signal?.aborted){const fault=error as Error&{cause?:Error&{code?:string}};console.error('controlled_fixture loopback failure',{address,path:String(path),listening:app.server.listening,code:fault.cause?.code,message:fault.cause?.message});}throw error;}
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0]!;
   return response;
  };
  const foundation=createFoundationApi(transport),api=createRuntimeApi(transport),signal=new AbortController().signal;
  return {foundation,api,signal,transport,cookie:()=>cookie,enter:()=>foundation.createSession('controlled-trial-code',signal),
   draft:()=>foundation.createInvestigation({originalQuestion:'controlled_fixture：请核对报名截止日期',basicMode:'truth',presentationMode:'evidence'},'controlled-truth-draft',signal)};
 }
 const one=browser(options.cookie);if(!options.cookie)await one.enter();return {app,one,browser,calls,entered,address,searchRequests,modelStages,responses};
}
async function terminal(api:ReturnType<typeof createRuntimeApi>,runId:string,signal:AbortSignal) {
 for(let i=0;i<100;i++){const view=await api.getRun(runId,signal);if(['completed','partial','failed','cancelled'].includes(view.run.status))return view;await new Promise<void>(r=>setImmediate(r));}
 throw Error('truth fixture did not finish');
}
it('stops actual I at the persistent campaign model cap and keeps captured sources without a rejected extra model send',async()=>{
 const s=await setup({paidCampaign:{id:'controlled_fixture-model-cap',moneyMicros:20000000,requestLimit:10,operationLimits:{search:3,read:3,model:2,tts:0},expiresAt:new Date(Date.now()+3600000).toISOString()}});
 const inv=await s.one.draft(),started=await s.one.api.startRun(inv.id,{action:'start',previousRunId:null},'controlled-model-cap-start',s.one.signal);
 const done=await terminal(s.one.api,started.runId,s.one.signal);
 expect(done.run.stopReason).toBe('model_limit');expect(done.run.status).toBe('partial');
 expect(s.modelStages).toEqual(['investigation.scope.grounded.v1','investigation.scope.review.v1']);
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
 expect(result.version.payload.sources).toHaveLength(1);expect(result.version.payload.claims).toHaveLength(0);
 expect(s.calls.filter(call=>call.path==='/chat/completions')).toHaveLength(2);
});
it('persists a cross-claim deadline conflict through actual HTTP, I, gateway and immutable snapshot instead of completing the case',async()=>{
 const s=await setup({sourceCount:2,conflictingDeadlines:true}),draft=await s.one.draft();
 const started=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-conflicting-deadlines',s.one.signal),done=await terminal(s.one.api,started.runId,s.one.signal);
 expect(done.run.status).toBe('partial');expect(done.run.stopReason).not.toBe('answered');
 const view=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal),payload=view.version.payload;
 expect(payload.claims).toHaveLength(2);expect(payload.claims.map(claim=>claim.status)).toEqual(['mixed','mixed']);expect(payload.sources).toHaveLength(2);expect(payload.conflicts.length).toBeGreaterThan(0);
 expect(new Set(payload.conflicts.flatMap(conflict=>conflict.claimIds))).toEqual(new Set(payload.claims.map(claim=>claim.id)));
 expect(new Set(payload.conflicts.flatMap(conflict=>conflict.evidenceIds))).toEqual(new Set(payload.evidence.map(evidence=>evidence.id)));
 expect(s.responses.review).toBe(1);expect(done.remainingBudget.used).toMatchObject({searches:1,reads:2,modelCalls:4});
 expect((await s.one.api.getResult(view.version.id,s.one.signal)).version.payloadHash).toBe(view.version.payloadHash);
});
it('connects W HTTP client, actual I, real normalizers, gateway ledger and immutable result store',async()=>{
 const s=await setup(),draft=await s.one.draft();
 const start=()=>s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-truth-start',s.one.signal);
 const [first,repeated]=await Promise.all([start(),start()]);expect(first.runId).toBe(repeated.runId);
 const done=await terminal(s.one.api,first.runId,s.one.signal);expect(done.run.status).toBe('completed');
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
 expect(result.version.payload.summary).toContain('十月三十日');
 expect(result.version.payload.conditions).toContain('仅适用于本科生');
 expect(result.version.payload.evidence[0]!.excerpt).toContain('仅适用于本科生');
 expect(done.remainingBudget.used).toMatchObject({searches:1,reads:1,modelCalls:3,inputTokens:300,outputTokens:150,moneyMicros:32800});
 expect(s.calls.map(c=>c.path)).toEqual(['/chat/completions','/chat/completions','/SearchPro','/v1/tools/fetch','/chat/completions']);
 const events=await s.one.api.getEvents(draft.id,0,s.one.signal);expect(events.items.some(e=>e.type==='query.completed')).toBe(true);
 const two=s.browser();await two.enter();await expect(two.api.getResult(result.version.id,two.signal)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await s.one.api.copyResult(result.version.id,s.one.signal)).text).toContain('仅适用于本科生');
});
it('records each successful query and source once instead of duplicating adapter and engine events',async()=>{
 const s=await setup(),draft=await s.one.draft();
 const started=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-single-ledger',s.one.signal);
 await terminal(s.one.api,started.runId,s.one.signal);
 const events=(await s.one.api.getEvents(draft.id,0,s.one.signal)).items;
 for(const type of ['query.started','query.completed','source.read'])expect(events.filter(event=>event.type===type)).toHaveLength(1);
});
it('cancels a late actual-I provider response without publishing it or resetting the budget on resume',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const s=await setup({modelGate:gate});
 try {
  const draft=await s.one.draft(),run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-cancel',s.one.signal);
  await s.entered;
  const cancelled=await s.one.api.cancel(run.runId,'controlled-cancel-key',s.one.signal);
  expect(cancelled.status).toBe('cancelled');release();
  const state=await terminal(s.one.api,run.runId,s.one.signal);expect(state.run.createdResultVersionId).toBeNull();
  expect(s.calls.filter(c=>c.path==='/chat/completions')).toHaveLength(3);
  const resume=await s.one.api.startRun(draft.id,{action:'resume',previousRunId:run.runId},'controlled-resume',s.one.signal);
  expect(resume.budgetWindowId).toBe(run.budgetWindowId);
  const done=await terminal(s.one.api,resume.runId,s.one.signal);expect(done.remainingBudget.used.searches).toBeGreaterThanOrEqual(1);
 }finally{release();}
});
it('does not retry authentication failures and never returns raw provider secrets/messages',async()=>{
 const s=await setup({authFailure:true}),draft=await s.one.draft();
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-auth',s.one.signal);
 const done=await terminal(s.one.api,run.runId,s.one.signal);
 expect(done.run.status).toBe('failed');expect(done.run.stopReason).toBe('provider_error');expect(s.calls).toHaveLength(1);
 expect(JSON.stringify(done)).not.toContain('should never be exposed');
 const events=await s.one.api.getEvents(draft.id,0,s.one.signal);expect(events.items.find(e=>e.type==='provider.failed')?.message).toContain('鉴权');
});
it('retains captured material and stops before evaluation when the shared money pool runs out after scope',async()=>{
 const s=await setup({moneyMicros:32200}),draft=await s.one.draft();
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-empty-money',s.one.signal);
 const done=await terminal(s.one.api,run.runId,s.one.signal);
 expect(done.run).toMatchObject({status:'partial',stopReason:'cost_limit'});
 expect(s.calls.map(c=>c.path)).toEqual(['/chat/completions','/chat/completions','/SearchPro','/v1/tools/fetch']);
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
 expect(result.version.payload.evidence).toHaveLength(1);expect(result.version.payload.claims).toHaveLength(0);
});
it('reconnects after a browser read is aborted, retains old versions, and survives a server restart',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'controlled-truth-')),databasePath=join(folder,'state.db');
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const s=await setup({databasePath,modelGate:gate});
 try {
  const draft=await s.one.draft(),first=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-first-version',s.one.signal);
  await s.entered;const disconnected=new AbortController();disconnected.abort();
  await expect(s.one.api.getRun(first.runId,disconnected.signal)).rejects.toBeDefined();
  release();const done=await terminal(s.one.api,first.runId,s.one.signal);
  const old=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
  const second=await s.one.api.startRun(draft.id,{action:'add_budget',previousRunId:first.runId},'controlled-next-version',s.one.signal);
  const done2=await terminal(s.one.api,second.runId,s.one.signal);expect(done2.run.status).toBe('completed');
  const updated=await s.one.api.getResult(old.version.id,s.one.signal);
  expect(updated.version).toEqual(old.version);expect(updated.updateNotice?.latestResultVersionId).toBe(done2.run.createdResultVersionId);
  const next=await s.one.api.getResult(done2.run.createdResultVersionId!,s.one.signal);expect(next.version.previousVersionId).toBe(old.version.id);
  const cookie=s.one.cookie();await s.app.close();
  const restored=await setup({databasePath,cookie});
  expect((await restored.one.api.getResult(old.version.id,restored.one.signal)).version).toEqual(old.version);
  const state=await restored.one.api.getRun(first.runId,restored.one.signal);
  expect(state.remainingBudget.used.searches).toBe(done.remainingBudget.used.searches);expect(restored.calls).toHaveLength(0);
  const events=await restored.one.api.getEvents(draft.id,0,restored.one.signal);
  const tail=await restored.one.api.getEvents(draft.id,events.nextSeq,restored.one.signal);expect(tail.items).toHaveLength(0);
  await restored.app.close();
 }finally{release();await s.app.close();rmSync(folder,{recursive:true,force:true});}
});
it('persists an actual-I clarification answer and only then starts provider calls',async()=>{
 const s=await setup(),draft=await s.one.foundation.createInvestigation({originalQuestion:'？',basicMode:'truth',presentationMode:'evidence'},'controlled-clarify-draft',s.one.signal);
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-clarify-run',s.one.signal);
 let view=await s.one.api.getRun(run.runId,s.one.signal);
 for(let i=0;view.run.status!=='waiting_for_user'&&i<50;i++){await new Promise<void>(r=>setImmediate(r));view=await s.one.api.getRun(run.runId,s.one.signal);}
 expect(view.run.status).toBe('waiting_for_user');expect(s.calls).toHaveLength(0);
 await s.one.api.answerClarification(run.runId,view.clarification!.id,{answer:'controlled_fixture 报名截止日期',proceedWithUnknown:false},s.one.signal);
 const done=await terminal(s.one.api,run.runId,s.one.signal);expect(done.run.status).toBe('completed');
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
 expect(result.version.payload.scope.knownClues).toContain('controlled_fixture 报名截止日期');
 expect(result.version.payload.scope.goal).toBe('？');expect(result.version.payload.scope.claimsToCheck).toEqual(['？']);
});
it('exposes the accepted core profile and runs latest conservatively when capture has no effective-date evidence',async()=>{
 const s=await setup(),draft=await s.one.foundation.createInvestigation({originalQuestion:'controlled_fixture 最新消息',basicMode:'latest',presentationMode:'evidence'},'controlled-latest-draft',s.one.signal);
 const capabilities=await s.one.transport('/api/v1/capabilities');expect((await capabilities.json()).data).toMatchObject({basicModes:['truth','latest','identify'],followups:true,watches:true,vision:false});
 const started=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-latest-start',s.one.signal),done=await terminal(s.one.api,started.runId,s.one.signal);
 expect(done.run.status).toBe('partial');expect(done.run.stopReason).not.toBe('answered');
 expect(s.calls.some(call=>call.path==='/SearchPro')).toBe(true);expect(s.calls.filter(call=>call.path==='/SearchPro').every(call=>!Object.hasOwn(call.body,'Freshness'))).toBe(true);
 const health=await s.one.transport('/health/ready');expect((await health.json()).data.capabilities).toContain('watches');
});
it('restarts an interrupted actual-I task without replaying its unknown model request or resetting elapsed work',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'controlled-truth-restart-')),databasePath=join(folder,'state.db');
 let tick=Date.now();const now=()=>new Date(tick).toISOString();
 const s=await setup({databasePath,modelWaitForAbort:true,now});
 try {
  const draft=await s.one.draft(),first=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-restart-first',s.one.signal);
  await s.entered;tick+=5000;
  expect((await s.one.api.getRun(first.runId,s.one.signal)).remainingBudget.used.activeMs).toBe(5000);
  const cookie=s.one.cookie();await s.app.close();tick+=10000;
  const restored=await setup({databasePath,cookie,now});
  try {
   const interrupted=await restored.one.api.getRun(first.runId,restored.one.signal);
   expect(interrupted.run.status).toBe('interrupted');expect(restored.calls).toHaveLength(0);
   expect(interrupted.remainingBudget.used.activeMs).toBe(5000);expect(interrupted.remainingBudget.reserved.modelCalls).toBe(1);
   const resumed=await restored.one.api.startRun(draft.id,{action:'resume',previousRunId:first.runId},'controlled-restart-resume',restored.one.signal);
   expect(resumed.budgetWindowId).toBe(first.budgetWindowId);
   const done=await terminal(restored.one.api,resumed.runId,restored.one.signal);expect(done.run.status).toBe('completed');
   expect(done.remainingBudget.used.activeMs).toBe(5000);expect(done.remainingBudget.reserved.modelCalls).toBe(1);
  }finally{await restored.app.close();}
 }finally{await s.app.close();rmSync(folder,{recursive:true,force:true});}
});
it('does not turn a search snippet into a verified answer when the actual capture has no readable text',async()=>{
 const s=await setup({emptyRead:true}),draft=await s.one.draft();
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-no-readable-text',s.one.signal);
 const done=await terminal(s.one.api,run.runId,s.one.signal);
 expect(done.run).toMatchObject({status:'partial',stopReason:'provider_error'});
 expect(s.calls.map(c=>c.path)).toEqual(['/chat/completions','/chat/completions','/SearchPro','/v1/tools/fetch']);
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
 expect(result.version.payload.sources).toHaveLength(1);expect(result.version.payload.sources[0]).toMatchObject({url:'https://example.invalid/notice/0',readStatus:'snippet_only',fetchedAt:null,contentHash:null});
 expect(result.version.payload.evidence).toEqual([]);expect(result.version.payload.claims).toEqual([]);
});
it('retains an unknown read attempt across an explicit new grant and does not resume a terminal partial',async()=>{
 const s=await setup({readNetworkFailure:true}),draft=await s.one.draft();
 const first=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-read-unknown',s.one.signal);
 const done=await terminal(s.one.api,first.runId,s.one.signal);expect(done.run).toMatchObject({status:'partial',stopReason:'provider_error'});
 const old=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);expect(old.version.payload.sources[0]).toMatchObject({url:'https://example.invalid/notice/0',readStatus:'snippet_only',fetchedAt:null,contentHash:null});
 expect(old.version.payload.evidence).toEqual([]);expect(old.version.payload.claims).toEqual([]);expect(JSON.stringify(old)).not.toContain('controlled_fixture_private_read_failure');
 expect(done.remainingBudget.reserved.reads).toBe(1);expect(s.calls).toHaveLength(4);
 await expect(s.one.api.startRun(draft.id,{action:'resume',previousRunId:first.runId},'controlled-read-unknown-resume',s.one.signal)).rejects.toMatchObject({code:'INVALID_STATE'});
 const continued=await s.one.api.startRun(draft.id,{action:'add_budget',previousRunId:first.runId},'controlled-read-unknown-new-grant',s.one.signal);
 expect(continued.budgetWindowId).not.toBe(first.budgetWindowId);await terminal(s.one.api,continued.runId,s.one.signal);
 expect(s.calls).toHaveLength(4);expect((await s.one.api.getRun(first.runId,s.one.signal)).remainingBudget.reserved.reads).toBe(1);expect((await s.one.api.getResult(old.version.id,s.one.signal)).version).toEqual(old.version);
});
it('reads no more than the requested limit even when the provider returns ten candidates',async()=>{
 const s=await setup({sourceCount:10}),draft=await s.one.draft();
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-request-limit',s.one.signal);
 const done=await terminal(s.one.api,run.runId,s.one.signal);
 expect(done.run).toMatchObject({status:'completed',stopReason:'answered'});
 expect(s.searchRequests[0]?.limit).toBe(3);expect(s.calls.filter(c=>c.path==='/v1/tools/fetch')).toHaveLength(s.searchRequests[0]!.limit);
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);
 expect(result.version.payload.sources).toHaveLength(3);expect(done.remainingBudget.used.reads).toBe(3);
});
it('carries evaluate v2 and coverage review v1 through the real gateway without promoting a related claim',async()=>{
 const s=await setup(),draft=await s.one.foundation.createInvestigation({originalQuestion:'controlled_fixture 公告是否表示人人都能报名？',basicMode:'truth',presentationMode:'evidence'},'controlled-coverage-draft',s.one.signal);
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-coverage-start',s.one.signal),done=await terminal(s.one.api,run.runId,s.one.signal);
 expect(s.modelStages).toEqual(['investigation.scope.grounded.v1','investigation.scope.review.v1','investigation.evaluate.v2','investigation.review.v1']);expect(done.remainingBudget.used.modelCalls).toBe(4);expect(done.run.status).toBe('partial');expect(done.run.stopReason).not.toBe('answered');
 expect(s.responses.review).toBe(1);
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);expect(result.version.payload.claims[0]?.status).toBe('insufficient');expect(result.version.payload.conditions).toContain('仅适用于本科生');expect(result.version.payload.unknowns.join(' ')).toContain('核心问题');
});
it('creates fresh HTTP sessions across eight complete server lifecycles reusing the same loopback port',async()=>{
 let port:number|undefined;
 for(let cycle=0;cycle<8;cycle++){
  const s=await setup({port:port??0});port=Number(new URL(s.address).port);
  try{expect((await s.one.foundation.getSession(s.one.signal)).accessGroup).toBe('trial');expect(s.calls).toHaveLength(0);}
  finally{await s.app.close();}
 }
});
it('preserves both successful captures and stops at an explicit two-read budget without a third read or evaluation',async()=>{
 const s=await setup({sourceCount:10,readLimit:2}),draft=await s.one.draft();
 const run=await s.one.api.startRun(draft.id,{action:'start',previousRunId:null},'controlled-read-limit',s.one.signal);
 const done=await terminal(s.one.api,run.runId,s.one.signal);
 expect(done.run).toMatchObject({status:'partial',stopReason:'read_limit'});
 expect(s.calls.filter(c=>c.path==='/v1/tools/fetch')).toHaveLength(2);expect(s.modelStages).toEqual(['investigation.scope.grounded.v1','investigation.scope.review.v1']);
 expect(done.remainingBudget.used.reads).toBe(2);expect(done.remainingBudget.remaining.reads).toBe(0);
 const result=await s.one.api.getResult(done.run.createdResultVersionId!,s.one.signal);expect(result.version.payload.evidence).toHaveLength(2);expect(result.version.payload.sources.every(source=>source.readStatus==='full')).toBe(true);expect(result.version.payload.claims).toHaveLength(0);
});

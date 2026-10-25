import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { samplePayload } from '../helpers/result.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import type { InvestigationModule } from '../../src/shared/ports.js';
const origin='http://127.0.0.1:5173';
const apps:ReturnType<typeof buildApp>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
function setup(kind:'significant'|'unchanged'|'unknown'='significant') {
 const money={...zeroAmounts(),activeMs:100000000,searches:1000,reads:1000,modelCalls:1000,inputTokens:10000000,outputTokens:10000000,moneyMicros:100000000};
 const module:InvestigationModule={
  prepareInvestigation:async input=>({scope:{...samplePayload().scope,basicMode:input.basicMode},clarification:null,canInvestigate:true}),
  runInvestigation:async(input,services)=>{
   const payload={...samplePayload(),scope:input.scope,investigationId:input.context.investigationId,runId:input.run.id,queryTime:services.clock.now()};
   if(input.intent==='watch'){payload.summary='controlled_fixture：报名截至十一月一日';payload.claims[0]!.statement=payload.summary;payload.evidence[0]!.excerpt=payload.summary;}
   await services.checkpoint.save(input.run.id,input.context.epoch,{sources:payload.sources,evidence:payload.evidence,claims:payload.claims});
   return {completion:'completed',stopReason:'answered',draft:payload,clarification:null};
  },
  routeFollowup:async()=>{throw Error('unused');},
  compareWatchResult:async input=>({kind,reason:'controlled_fixture：比较',factSignature:'b'.repeat(64),
   changes:kind==='significant'?[{kind:'conclusion',description:'截止日期变化',claimIds:[input.candidate.claims[0]!.id],evidenceIds:[input.candidate.evidence[0]!.id]}]:[]}),
 };
 const unavailable=async():Promise<never>=>{throw Error('no paid calls');};
 const app=buildApp({databasePath:':memory:',allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',
  serviceEndsAt:new Date(Date.now()+172800000).toISOString(),secureCookies:false,investigationRuntime:{
   module,providers:{search:unavailable,model:unavailable,read:unavailable},funding:{global:money,trial:money,demo:money},
   pricing:{quote:()=>({provider:'controlled',purpose:'controlled',priceRevision:'fixture',attemptNo:1,timeoutMs:1000,estimated:{...zeroAmounts(),moneyMicros:10}}),actual:()=>null},
  }});
 apps.push(app);return app;
}
async function user(app:ReturnType<typeof buildApp>) {
 const login=await app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}});
 return {origin,cookie:String(login.headers['set-cookie']).split(';')[0]!,'idempotency-key':'controlled-watch-http'};
}
async function waitFor<T>(read:()=>Promise<T>,predicate:(value:T)=>boolean) {
 for(let i=0;i<150;i++){const value=await read();if(predicate(value))return value;await new Promise<void>(r=>setTimeout(r,2));}
 throw Error('controlled operation did not settle');
}
async function baseline(app:ReturnType<typeof buildApp>,headers:Record<string,string>) {
 const draft=await app.inject({method:'POST',url:'/api/v1/investigations',headers,payload:{originalQuestion:'controlled_fixture：日期',basicMode:'truth',presentationMode:'evidence'}});
 const id=draft.json().data.id;
 const run=await app.inject({method:'POST',url:'/api/v1/investigations/'+id+'/runs',headers,payload:{action:'start',previousRunId:null}});
 const state=await waitFor(async()=>(await app.inject({url:'/api/v1/runs/'+run.json().data.runId,headers})).json().data,v=>v.run.status==='completed');
 return {id,versionId:state.run.createdResultVersionId};
}
it('accepts a durable check and returns a real notification only after atomic changed completion',async()=>{
 const app=setup(),a=await user(app),b=await user(app),base=await baseline(app,a);
 const payload={investigationId:base.id,resultVersionId:base.versionId,targetKind:'open_question',targetUrls:[],focus:'报名截止日期'};
 const created=await app.inject({method:'POST',url:'/api/v1/watches',headers:a,payload});
 expect(created.statusCode).toBe(201);const id=created.json().data.id;
 const checkUrl='/api/v1/watches/'+id+'/checks';
 const request=()=>app.inject({method:'POST',url:checkUrl,headers:a});
 const [one,two]=await Promise.all([request(),request()]);
 expect(one.statusCode).toBe(202);expect(two.json().data.watchCheckId).toBe(one.json().data.watchCheckId);
 const checkId=one.json().data.watchCheckId;
 const checks=await waitFor(async()=>(await app.inject({url:checkUrl,headers:a})).json().data,v=>v.items.some((c:{id:string;status:string})=>c.id===checkId&&c.status==='changed'));
 expect(checks.items).toHaveLength(1);
 const notifications=await app.inject({url:'/api/v1/notifications',headers:a});
 expect(notifications.json().data.unreadCount).toBe(1);const notice=notifications.json().data.items[0];
 expect(notice).not.toHaveProperty('sessionId');
 expect((await app.inject({url:'/api/v1/notifications',headers:b})).json().data.items).toHaveLength(0);
 expect((await app.inject({url:checkUrl,headers:b})).statusCode).toBe(404);
 const old=await app.inject({url:'/api/v1/results/'+base.versionId,headers:a});
 expect(old.json().data.updateNotice.latestResultVersionId).toBe(notice.targetResultVersionId);
 expect(old.json().data.version.payload.summary).toContain('十月三十日');
 const mark=await app.inject({method:'PATCH',url:'/api/v1/notifications/'+notice.id,headers:a,payload:{read:true}});
 expect(mark.statusCode).toBe(200);
 expect((await app.inject({url:'/api/v1/notifications',headers:a})).json().data.unreadCount).toBe(0);
});
it('records unknown without notification and supports authenticated pause resume and delete',async()=>{
 const app=setup('unknown'),headers=await user(app),base=await baseline(app,headers);
 const created=await app.inject({method:'POST',url:'/api/v1/watches',headers,payload:{investigationId:base.id,resultVersionId:base.versionId,targetKind:'open_question',targetUrls:[],focus:'报名时间'}});
 expect(created.statusCode).toBe(201);const id=created.json().data.id,url='/api/v1/watches/'+id;
 const accepted=await app.inject({method:'POST',url:url+'/checks',headers});expect(accepted.statusCode).toBe(202);
 const checks=await waitFor(async()=>(await app.inject({url:url+'/checks',headers})).json().data,v=>v.items[0]?.status==='unknown');
 expect(checks.items[0].afterVersionId).toBeNull();
 expect((await app.inject({url:'/api/v1/notifications',headers})).json().data.items).toHaveLength(0);
 const again=await app.inject({method:'POST',url:url+'/checks',headers:{...headers,'idempotency-key':'second-manual-check'}});
 expect(again.statusCode).toBe(429);
 for(const action of ['pause','resume'])expect((await app.inject({method:'PATCH',url,headers,payload:{action}})).statusCode).toBe(200);
 expect((await app.inject({method:'DELETE',url,headers})).statusCode).toBe(204);
 expect((await app.inject({url:'/api/v1/watches',headers})).json().data.items).toHaveLength(0);
});

it('treats failed fixed-page reads as unknown even if the comparator proposes a change',async()=>{
 const app=setup(),headers=await user(app),base=await baseline(app,headers);
 const created=await app.inject({method:'POST',url:'/api/v1/watches',headers,payload:{investigationId:base.id,resultVersionId:base.versionId,targetKind:'page',targetUrls:['https://example.invalid/notice'],focus:'报名时间'}});
 expect(created.statusCode).toBe(201);const id=created.json().data.id;
 expect((await app.inject({method:'POST',url:'/api/v1/watches/'+id+'/checks',headers})).statusCode).toBe(202);
 const check=await waitFor(async()=>(await app.inject({url:'/api/v1/watches/'+id+'/checks',headers})).json().data,v=>v.items[0]?.status==='unknown');
 expect(check.items[0].afterVersionId).toBeNull();
 expect((await app.inject({url:'/api/v1/notifications',headers})).json().data.items).toHaveLength(0);
 const watches=(await app.inject({url:'/api/v1/watches',headers})).json().data.items;
 expect(watches[0].reservedMicros).toBe(10);
});
it.each(['http://127.0.0.1/','http://169.254.169.254/','http://[::1]/','http://localhost/'])('rejects private fixed-page target %s before scheduling',async target=>{
 const app=setup(),headers=await user(app),base=await baseline(app,headers);
 const created=await app.inject({method:'POST',url:'/api/v1/watches',headers,payload:{investigationId:base.id,resultVersionId:base.versionId,targetKind:'page',targetUrls:[target],focus:'报名时间'}});
 expect(created.statusCode).toBe(400);
});

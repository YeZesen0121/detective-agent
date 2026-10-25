import { expect, it } from 'vitest';
import { buildApp, type FoundationOptions } from '../../src/server/app.js';
import { harness, moduleFor } from '../web-model/runtime-http-fixture.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { createLiveExperienceRuntime } from '../../src/server/platform/experience-runtime.js';

const empty={basicModes:[],followups:false,watches:false,vision:false,companion:false,audio:false,newInvestigations:{available:false,reason:'unconfigured',message:'当前尚未配置调查服务，可以保留草稿。'}};
it('reports a depleted shared model allowance before starting a new case while retaining drafts and followup availability',async()=>{
 let calls=0;const forbidden=async()=>{calls++;throw Error('controlled_fixture unexpected provider');};
 const funds={activeMs:1000000,searches:100,reads:100,modelCalls:100,inputTokens:100000,outputTokens:100000,moneyMicros:1000000};
 const app=buildApp({databasePath:':memory:',allowedOrigin:'http://127.0.0.1:5173',trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:'2026-10-26T08:00:00.000Z',secureCookies:false,
  paidCampaign:{id:'controlled_fixture-depleted',moneyMicros:1000000,requestLimit:2000,operationLimits:{search:2000,read:2000,model:0,tts:2000},expiresAt:'2026-10-26T08:00:00.000Z'},
  investigationRuntime:{module:moduleFor(),enableFollowups:true,enableWatches:false,providers:{search:forbidden,read:forbidden,model:forbidden},funding:{global:funds,trial:funds,demo:funds},pricing:{quote:()=>{throw Error('unexpected quote');},actual:()=>null}}});
 try{const login=await app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin:'http://127.0.0.1:5173'},payload:{code:'controlled-trial-code'}});const headers={origin:'http://127.0.0.1:5173',cookie:String(login.headers['set-cookie']).split(';')[0]!, 'idempotency-key':'controlled-depleted-case'};
 const caps=(await app.inject({url:'/api/v1/capabilities',headers})).json().data;expect(caps.newInvestigations).toMatchObject({available:false,reason:'model_limit'});expect(caps.followups).toBe(true);
 const draft=(await app.inject({method:'POST',url:'/api/v1/investigations',headers,payload:{originalQuestion:'controlled_fixture keep this input',basicMode:'truth',presentationMode:'brief'}})).json().data;
 const start=await app.inject({method:'POST',url:`/api/v1/investigations/${draft.id}/runs`,headers,payload:{action:'start',previousRunId:null}});expect(start.statusCode).toBe(409);expect(start.json().error.code).toBe('BUDGET_EXHAUSTED');expect(start.json().error.message).toContain('模型');
 const saved=(await app.inject({url:`/api/v1/investigations/${draft.id}`,headers})).json().data;expect(saved.investigation.originalQuestion).toBe('controlled_fixture keep this input');expect(saved.activeRun).toBeNull();expect(calls).toBe(0);
 }finally{await app.close();}
});
it('does not expose operational capabilities before authentication, or advertise unconfigured generation',async()=>{
 const h=harness(null);try{
  expect((await h.app.inject({method:'GET',url:'/api/v1/capabilities'})).statusCode).toBe(401);
  const browser=h.browser();await browser.enter();
  const response=await browser.transport('/api/v1/capabilities');expect(response.status).toBe(200);expect((await response.json()).data).toEqual(empty);expect(h.paidCalls).toBe(0);
 }finally{await h.app.close();}
});
it('advertises only the configured modes and supported media operations without calling a provider',async()=>{
 const funds={...zeroAmounts(),activeMs:10000,moneyMicros:20000000},funding={global:funds,trial:funds,demo:funds};
 let calls=0;const forbidden=async()=>{calls++;throw Error('controlled_fixture provider forbidden');};
 const runtime:NonNullable<FoundationOptions['investigationRuntime']>={module:moduleFor(),providers:{search:forbidden,read:forbidden,model:forbidden},funding,
  supportedBasicModes:['truth','identify'],enableFollowups:true,enableWatches:false,supportsAttachments:true,
  pricing:{quote:()=>{throw Error('controlled_fixture quote forbidden');},actual:()=>null}};
 const experienceRuntime=createLiveExperienceRuntime({deepseekKey:'controlled_fixture_key',funding,fetch:forbidden,tts:{secretId:'controlled_fixture_id',secretKey:'controlled_fixture_key',voiceIds:['zh-male-zhike']}});
 const app=buildApp({databasePath:':memory:',allowedOrigin:'http://127.0.0.1:5173',trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:'2026-10-26T08:00:00.000Z',secureCookies:false,investigationRuntime:runtime,experienceRuntime});
 try{
  const session=await app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin:'http://127.0.0.1:5173'},payload:{code:'controlled-trial-code'}});
  const response=await app.inject({method:'GET',url:'/api/v1/capabilities',headers:{cookie:String(session.headers['set-cookie']).split(';')[0]!}});
  expect(response.statusCode).toBe(200);expect(response.json().data).toEqual({...empty,basicModes:['truth','identify'],followups:true,vision:true,companion:true,audio:true,newInvestigations:{available:true,reason:null,message:null}});expect(calls).toBe(0);
 }finally{await app.close();}
});

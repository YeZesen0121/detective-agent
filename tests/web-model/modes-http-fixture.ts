import { buildApp } from '../../src/server/app.js';
import type { BasicMode } from '../../src/shared/contracts.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { resolve } from 'node:path';
import { moduleFor } from './runtime-http-fixture.js';

export async function serveModes(worker:number,modes:BasicMode[]|null=['truth','latest','identify']){
 const site=`http://127.0.0.1:${33760+worker}`,requests:Array<{method:string;url:string;body:unknown}>=[],funds={...zeroAmounts(),activeMs:10000000,searches:200,reads:200,modelCalls:200,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};let realCalls=0;
 const forbidden=async()=>{realCalls++;throw Error('controlled_fixture forbids real providers');},module=moduleFor();
 module.routeFollowup=async()=>({route:'suggest_new_case',answer:null,researchPurpose:null,suggestedQuestion:'controlled_fixture 建议核对另一个对象'});
 const app=buildApp({databasePath:':memory:',allowedOrigin:site,trialCode:'controlled-modes-trial',demoCode:'controlled-modes-demo',serviceEndsAt:new Date(Date.now()+86400000).toISOString(),secureCookies:false,webRoot:resolve('dist/web'),...(modes?{investigationRuntime:{module,supportedBasicModes:modes,enableFollowups:true,enableWatches:false,providers:{search:forbidden,read:forbidden,model:forbidden},funding:{global:funds,trial:funds,demo:funds},pricing:{quote:()=>({provider:'controlled_fixture',purpose:'controlled_fixture',priceRevision:'controlled_fixture',attemptNo:1,timeoutMs:1000,estimated:{...zeroAmounts(),moneyMicros:1}}),actual:()=>null}}}:{})});
 app.addHook('preHandler',async request=>{requests.push({method:request.method,url:request.url,body:request.body});});await app.listen({host:'127.0.0.1',port:33760+worker});
 return{site,requests,get realCalls(){return realCalls;},async close(){await app.close();if(realCalls)throw Error('controlled_fixture attempted real provider');}};
}

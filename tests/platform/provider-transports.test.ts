import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createResearchProviders } from '../../src/server/platform/provider-transports.js';
import { createProviderPricing, PRICE_20261024 } from '../../src/server/platform/provider-pricing.js';
const credentials={search:{kind:'bearer' as const,apiKey:'controlled_fixture_key'},deepseekKey:'controlled_fixture_key'};
const signal=()=>new AbortController().signal;
const context={sessionId:randomUUID(),accessGroup:'trial' as const,investigationId:randomUUID(),runId:randomUUID(),budgetWindowId:randomUUID(),interactionPoolId:null,watchCheckId:null,epoch:1,watchLeaseEpoch:null,deadlineAt:'2026-10-25T00:00:00.000Z'};
const query={query:'controlled_fixture',purpose:'controlled_fixture',claimIds:[],site:null,freshness:null,limit:3};
it('keeps latest as an internal intent rather than sending an unsupported or arbitrary recency cutoff',async()=>{
 const payloads:unknown[]=[];
 const tc3=createResearchProviders({credentials:{search:{kind:'tc3',secretId:'controlled_fixture_id',secretKey:'controlled_fixture_key'},deepseekKey:'controlled_fixture_key'},tc3Send:async payload=>{payloads.push(payload);return{RequestId:'controlled_fixture',Pages:[]};}});
 const result=await tc3.search({...query,freshness:'latest'},context,signal());
 expect(payloads).toEqual([{Query:query.query,Cnt:10}]);expect(result.warnings.join(' ')).toContain('最新');
 await tc3.search({...query,freshness:'d7'},context,signal());expect(payloads.at(-1)).toMatchObject({Freshness:'d7'});
 let bearerPayload:unknown;
 const bearer=createResearchProviders({credentials,fetch:async(_url,init)=>{bearerPayload=JSON.parse(String(init?.body));return Response.json({Response:{RequestId:'controlled_fixture',Pages:[]}});}});
 await bearer.search({...query,freshness:'latest'},context,signal());expect(bearerPayload).toEqual({Query:query.query,Cnt:10});
});
it('rejects private DNS destinations before a paid Fetch send and aborts a stuck DNS resolution',async()=>{
 let sends=0;
 const providers=createResearchProviders({credentials,fetch:async()=>{sends++;throw Error('must not send');},resolve:async()=>['10.0.0.1']});
 await expect(providers.validateRead!('https://example.invalid',signal())).rejects.toMatchObject({kind:'invalid_request'});expect(sends).toBe(0);
 const stuck=createResearchProviders({credentials,resolve:()=>new Promise(()=>{})}),abort=new AbortController();
 const pending=stuck.validateRead!('https://example.invalid',abort.signal).then(()=> 'resolved',()=> 'rejected');abort.abort();
 const state=await Promise.race([pending,new Promise(r=>setTimeout(()=>r('still_pending'),25))]);expect(state).toBe('rejected');
});
it('uses official TC3 request fields and passes the AbortSignal without a retry loop',async()=>{
 const sent:Array<unknown>=[],controller=new AbortController();
 const providers=createResearchProviders({credentials:{search:{kind:'tc3',secretId:'controlled_fixture_id',secretKey:'controlled_fixture_key'},deepseekKey:'controlled_fixture_key'},
  tc3Send:async(payload,abort)=>{sent.push(payload,abort);return {RequestId:'controlled_fixture',Pages:[]};}});
 expect((await providers.search(query,context,controller.signal)).items).toEqual([]);
 expect(sent).toEqual([{Query:'controlled_fixture',Cnt:10},controller.signal]);
 const denied=createResearchProviders({credentials:{search:{kind:'tc3',secretId:'controlled_fixture_id',secretKey:'controlled_fixture_key'},deepseekKey:'controlled_fixture_key'},
  tc3Send:async()=>{throw Object.assign(Error('controlled_fixture_secret'),{code:'AuthFailure.SignatureFailure'});}});
 await expect(denied.search(query,context,signal())).rejects.toMatchObject({kind:'auth'});
});
it('masks provider messages, rejects truncated or unexpected model versions and never retries POST',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>Response.json({error:{message:'controlled_fixture_secret'}},{status:401}));
 const providers=createResearchProviders({credentials,fetch:transport});
 await expect(providers.search(query,context,signal())).rejects.toMatchObject({kind:'auth',message:'外部服务调用未完成：auth'});expect(transport).toHaveBeenCalledTimes(1);
 const model={purpose:'evaluate' as const,promptVersion:'investigation.evaluate.v1',schemaId:'investigation.evaluate.v1',maxOutputTokens:100,messages:[{role:'user' as const,content:'controlled_fixture JSON'}]};
 for(const [id,finish] of [['deepseek-flash','length'],['different-price-model','stop']]){
  const raw=createResearchProviders({credentials,fetch:async()=>Response.json({model:id,choices:[{finish_reason:finish,message:{content:'{}'}}],usage:{prompt_tokens:1,completion_tokens:1}})});
  await expect(raw.model(model,context,signal())).rejects.toMatchObject({kind:'invalid_response'});
 }
});
it('expires reviewed price revisions and keeps missing model usage unknown',()=>{
 const pricing=createProviderPricing(PRICE_20261024,()=>PRICE_20261024.validUntil);
 expect(()=>pricing.quote('search',query)).toThrow();
 expect(pricing.actual('model',{value:{},modelId:'deepseek-flash',finishReason:'stop',usage:null,providerRequestId:null})).toBeNull();
 expect(pricing.actual('read',{sourceId:randomUUID(),finalUrl:'https://example.invalid',title:null,text:null,readStatus:'inaccessible',fetchedAt:'2026-10-24T00:00:00.000Z',contentHash:null,failureCode:'controlled_fixture',usage:null})?.moneyMicros).toBe(5000);
});

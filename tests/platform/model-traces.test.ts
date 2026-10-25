import { afterEach,expect,it } from 'vitest';
import { budgetScenario } from '../helpers/budget-scenario.js';
import { PaidGateway } from '../../src/server/platform/gateway.js';
import { bindResearchServices, type ResearchCallObserver } from '../../src/server/platform/services.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { ProviderModelTraces } from '../../src/server/platform/model-traces.js';
import type { ModelResponse } from '../../src/shared/ports.js';
const clean:Array<()=>void>=[];afterEach(()=>{for(const fn of clean.splice(0))fn();});
const request={purpose:'evaluate' as const,promptVersion:'investigation.context-screen.v1',schemaId:'investigation.context-screen.v1',maxOutputTokens:600,messages:[{role:'user' as const,content:'controlled_fixture publicly captured material'}]};
const response:ModelResponse={value:{screened:false,omittedRelevantQuotes:[],reason:'controlled_fixture irrelevant'},usage:{inputTokens:10,outputTokens:10,characters:0,searches:0,reads:0},modelId:'controlled_fixture_model',finishReason:'stop',providerRequestId:'controlled_fixture_request'};
function setup(model:()=>Promise<ModelResponse>,next?:ResearchCallObserver){const s=budgetScenario();clean.push(()=>s.db.close());const unavailable=async()=>{throw Error('controlled_fixture unused');};
 const gateway=new PaidGateway({book:s.book,poolIds:()=>s.poolIds,assertCurrent:()=>{},concurrency:{search:1,read:1,model:1,tts:1}});
 const api=bindResearchServices({search:unavailable,read:unavailable,model}, {quote:()=>({provider:'controlled_fixture',purpose:'model',attemptNo:1,priceRevision:'fixture-v1',timeoutMs:1000,estimated:{...zeroAmounts(),modelCalls:1,inputTokens:2000,outputTokens:600,moneyMicros:10}}),actual:()=>({...zeroAmounts(),modelCalls:1,inputTokens:10,outputTokens:10,moneyMicros:6})},gateway,s.context,{clock:{now:()=>new Date().toISOString()},checkpoint:{save:unavailable},events:{append:unavailable},budget:{snapshot:async()=>s.book.snapshot(s.context,s.poolIds)}},new ProviderModelTraces(s.db).observer(next));
 return{...s,api};}
it('records the actual model stage and response against the original paid call without headers or extra sends',async()=>{
 let sends=0;const s=setup(async()=>{sends++;return response;});expect(await s.api.model(request,s.context,new AbortController().signal)).toEqual(response);
 const row=s.db.prepare('SELECT * FROM provider_model_traces').get() as any;expect(row).toMatchObject({schema_id:request.schemaId,prompt_version:request.promptVersion,model_id:response.modelId,response_omitted:0});expect(JSON.parse(row.request_json)).toEqual(request);expect(JSON.parse(row.response_json)).toEqual(response);expect(row.request_hash).toMatch(/^[a-f0-9]{64}$/);expect(row.response_hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(row)).not.toContain('Authorization');expect(sends).toBe(1);expect(s.book.inspectCall(row.call_id).status).toBe('settled');
});
it('does not manufacture a response or store raw provider failure text when a sent call fails',async()=>{
 const s=setup(async()=>{throw Error('controlled_fixture_private_provider_error');});await expect(s.api.model(request,s.context,new AbortController().signal)).rejects.toThrow();
 const row=s.db.prepare('SELECT * FROM provider_model_traces').get() as any;expect(row.response_json).toBeNull();expect(row.response_hash).toBeNull();expect(JSON.stringify(row)).not.toContain('controlled_fixture_private_provider_error');expect(s.book.inspectCall(row.call_id).status).toBe('unknown');
});
it('retains an explicit omission marker and response hash instead of unbounded model response contents',async()=>{
 const s=setup(async()=>({...response,value:{controlled_fixture:'x'.repeat(200000)}}));await s.api.model(request,s.context,new AbortController().signal);
 const row=s.db.prepare('SELECT response_json,response_hash,response_omitted,model_id FROM provider_model_traces').get() as any;expect(row.response_json).toBeNull();expect(row.response_hash).toMatch(/^[a-f0-9]{64}$/);expect(row.response_omitted).toBe(1);expect(row.model_id).toBe(response.modelId);
});
it.each(['INSERT','UPDATE'] as const)('keeps a valid paid result and core receipts when private trace %s fails',async operation=>{
 const phases:string[]=[];let sends=0;const s=setup(async()=>{sends++;return response;},{sent:()=>{phases.push('sent');},received:()=>{phases.push('received');}});
 s.db.exec(`CREATE TRIGGER controlled_fixture_trace_failure BEFORE ${operation} ON provider_model_traces BEGIN SELECT RAISE(FAIL, 'controlled_fixture diagnostic failure'); END`);
 await expect(s.api.model(request,s.context,new AbortController().signal)).resolves.toEqual(response);
 expect(phases).toEqual(['sent','received']);expect(sends).toBe(1);
 expect(s.db.prepare('SELECT status FROM usage_ledger').get()).toEqual({status:'settled'});
});
it('does not swallow an authoritative receipt error while isolating diagnostics',async()=>{
 const s=setup(async()=>response,{received:()=>{throw Error('controlled_fixture core receipt failure');}});
 await expect(s.api.model(request,s.context,new AbortController().signal)).rejects.toThrow('controlled_fixture core receipt failure');
 expect(s.db.prepare('SELECT status FROM usage_ledger').get()).toEqual({status:'unknown'});
});

import { afterEach,expect,it } from 'vitest';
import { runtimeSeed,later } from '../helpers/runtime.js';
import { ensureRuntimeFunding } from '../../src/server/platform/runtime-funding.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { PaidGateway } from '../../src/server/platform/gateway.js';
import { bindResearchServices,type ResearchPricing } from '../../src/server/platform/services.js';
import { ScopeModelReceipts } from '../../src/server/platform/scope-model-receipts.js';
import type { InvocationContext } from '../../src/shared/contracts.js';
import type { ModelRequest,ModelResponse } from '../../src/shared/ports.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/server/platform/database.js';
const close:Array<()=>void>=[];afterEach(async()=>{for(const fn of close.splice(0))fn();});
const request:ModelRequest={purpose:'scope',schemaId:'investigation.scope.grounded.v1',promptVersion:'controlled_fixture',maxOutputTokens:100,messages:[{role:'user',content:'controlled_fixture 原始线索'}]};
const response:ModelResponse={value:{controlled_fixture:'received'},modelId:'controlled_fixture',providerRequestId:'controlled_fixture_request',finishReason:'stop',usage:{inputTokens:10,outputTokens:10,characters:0,searches:0,reads:0}};
function seed(model:(signal:AbortSignal)=>Promise<ModelResponse>,path=':memory:'){
 const s=runtimeSeed(path);close.push(()=>s.db.close());const funds={...zeroAmounts(),activeMs:10000000,searches:100,reads:100,modelCalls:100,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};ensureRuntimeFunding(s.db,{global:funds,trial:funds,demo:funds});
 let context:InvocationContext={sessionId:s.owner,investigationId:s.investigationId,runId:s.run.id,budgetWindowId:s.windowId,interactionPoolId:null,watchCheckId:null,epoch:s.run.epoch,watchLeaseEpoch:null,accessGroup:'trial',deadlineAt:new Date(Date.now()+60000).toISOString()};
 const pools=['runtime:global','runtime:trial',s.windowId],gateway=new PaidGateway({book:s.book,poolIds:()=>pools,assertCurrent:ctx=>s.runs.assertCurrent(ctx),concurrency:{search:1,read:1,model:1,tts:1}}),receipts=new ScopeModelReceipts(s.db);
 const pricing:ResearchPricing={quote:()=>({provider:'controlled_fixture',purpose:'scope',priceRevision:'fixture-v1',attemptNo:1,timeoutMs:1000,estimated:{...zeroAmounts(),moneyMicros:100,inputTokens:2000,outputTokens:100,modelCalls:1}}),actual:()=>({...zeroAmounts(),moneyMicros:1,inputTokens:10,outputTokens:10,modelCalls:1})};
 const forbidden=async()=>{throw Error('controlled_fixture forbidden');};
 const core={clock:{now:()=>new Date().toISOString()},checkpoint:{save:forbidden},events:{append:forbidden},budget:{snapshot:async()=>s.book.snapshot(context,pools)}};
 const invoke=(signal=new AbortController().signal,input=request)=>receipts.invoke('controlled_fixture_source',input,context,signal,()=>s.runs.assertCurrent(context),observer=>bindResearchServices({search:forbidden,read:forbidden,model:(_input,_ctx,abort)=>model(abort)},pricing,gateway,context,core,observer).model(input,context,signal));
 const resume=()=>{s.runs.cancel(context.runId!,s.owner,later(2));const next=s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,budgetWindowId:s.windowId,key:'controlled-receipt-resume',action:'resume',previousRunId:context.runId,at:later(3)});const run=s.runs.claimNext(later(4))!;context={...context,runId:next.id,epoch:run.epoch};};
 return{...s,invoke,resume,gateway,pricing,get context(){return context;}};
}
it('reuses a received scope response across explicit resume without a second paid request or token-limit loophole',async()=>{
 let sends=0;const s=seed(async()=>{sends++;return response;});expect(await s.invoke()).toEqual(response);s.resume();expect(await s.invoke(undefined,{...request,maxOutputTokens:50})).toEqual(response);expect(sends).toBe(1);expect(s.db.prepare('SELECT count(*) n FROM usage_ledger').get()).toEqual({n:1});
 await expect(s.invoke(undefined,{...request,messages:[{role:'user',content:'changed without new user input'}]})).rejects.toThrow();expect(sends).toBe(1);
});
it('keeps a sent request without a response blocked after resume instead of automatically replaying it',async()=>{
 let sends=0;const s=seed(async()=>{sends++;throw Error('controlled_fixture unknown');});await expect(s.invoke()).rejects.toThrow();s.resume();await expect(s.invoke()).rejects.toThrow();await expect(s.invoke(undefined,{...request,maxOutputTokens:50})).rejects.toThrow();expect(sends).toBe(1);expect(s.book.inspectPool(s.windowId).reserved.modelCalls).toBe(1);
});
it('retains a late valid receipt after cancellation and reuses it only under the new authorized worker',async()=>{
 let release!:(value:ModelResponse)=>void,sends=0;const pending=new Promise<ModelResponse>(r=>{release=r;}),s=seed(async()=>{sends++;return pending;}),controller=new AbortController();
 const old=s.invoke(controller.signal);controller.abort();await expect(old).rejects.toThrow();release(response);await s.gateway.drain();s.resume();expect(await s.invoke()).toEqual(response);expect(sends).toBe(1);
});
it('allows another explicit attempt only when no supplier send occurred',async()=>{
 let sends=0;const s=seed(async()=>{sends++;return response;}),quote=s.pricing.quote;s.pricing.quote=()=>{throw Error('controlled_fixture unsent price failure');};await expect(s.invoke()).rejects.toThrow();expect(sends).toBe(0);s.pricing.quote=quote;expect(await s.invoke()).toEqual(response);expect(sends).toBe(1);
});
it('persists received responses across database connections and treats an interrupted pending intent as uncertain',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'detective-scope-receipt-')),path=join(directory,'runtime.db');let sends=0;const s=seed(async()=>{sends++;return response;},path);await s.invoke();
 const db=openDatabase(path);close.push(()=>db.close(),()=>rmSync(directory,{recursive:true,force:true}));const other=new ScopeModelReceipts(db),guard=()=>s.runs.assertCurrent(s.context),forbidden=async()=>{throw Error('controlled_fixture must not resend');};
 expect(await other.invoke('controlled_fixture_source',request,s.context,new AbortController().signal,guard,forbidden)).toEqual(response);
 db.prepare("UPDATE scope_model_receipts SET response_json=NULL,state='pending',call_id=NULL").run();await expect(other.invoke('controlled_fixture_source',request,s.context,new AbortController().signal,guard,forbidden)).rejects.toThrow();expect(sends).toBe(1);
});

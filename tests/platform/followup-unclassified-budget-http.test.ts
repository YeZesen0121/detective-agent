import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { investigationModule } from '../../src/server/investigation/index.js';
import { ExperienceStore } from '../../src/server/platform/experience-store.js';
import { ensureRuntimeFunding } from '../../src/server/platform/runtime-funding.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { sha256 } from '../../src/server/platform/repository.js';
import { runtimeSeed, time, later } from '../helpers/runtime.js';

// controlled_fixture: real persistent stores, paid accounting and I router. No supplier network.
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.useRealTimers();});
async function setup(exhaust:'interaction'|'research'){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(time);
 const directory=mkdtempSync(join(tmpdir(),'detective-unclassified-followup-')),s=runtimeSeed(join(directory,'runtime.db'));
 const funds={...zeroAmounts(),activeMs:10000000,searches:200,reads:200,modelCalls:200,inputTokens:10000000,outputTokens:1000000,moneyMicros:100000000};
 ensureRuntimeFunding(s.db,{global:funds,trial:funds,demo:funds});
 s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,time);
 s.runs.saveCheckpoint(s.run.id,s.run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},time);
 const version=s.runs.commitResult(s.run.id,s.run.epoch,s.payload,'completed',later(1));
 const interaction=new ExperienceStore(s.db,later(3600)).scope(s.owner,s.investigationId,later(2));
 const token='controlled_fixture_session',hash=sha256(token),session=JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as {payload_json:string}).payload_json);
 session.tokenHash=hash;s.db.prepare('UPDATE sessions SET token_hash=?,payload_json=? WHERE id=?').run(hash,JSON.stringify(session),s.owner);
 const context={sessionId:s.owner,accessGroup:'trial' as const,investigationId:s.investigationId,runId:exhaust==='interaction'?null:s.run.id,budgetWindowId:exhaust==='interaction'?null:s.windowId,interactionPoolId:exhaust==='interaction'?interaction:null,watchCheckId:null,watchLeaseEpoch:null,epoch:1,deadlineAt:later(3600)};
 for(let index=0;index<(exhaust==='interaction'?30:12);index++){
  const amounts={...zeroAmounts(),moneyMicros:1,...(exhaust==='interaction'?{modelCalls:1,inputTokens:1,outputTokens:1}:{searches:1})},callId=randomUUID();
  s.book.reserve(context,['runtime:global','runtime:trial',exhaust==='interaction'?interaction:s.windowId],{callId,provider:'controlled_fixture',operation:exhaust==='interaction'?'model':'search',purpose:'controlled_fixture prior settled usage',attemptNo:1,priceRevision:'fixture-v1',estimated:amounts});
  s.book.markSent(callId);s.book.settle(callId,amounts);
 }
 let classificationCalls=0,researchExecutions=0;
 const unavailable=async()=>{throw Error('controlled_fixture supplier forbidden');};
 const app=buildApp({databasePath:join(directory,'runtime.db'),allowedOrigin:'http://127.0.0.1:5173',trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:later(3600),secureCookies:false,now:()=>later(20),
  investigationRuntime:{module:{...investigationModule,runInvestigation:async(input,services,signal)=>{researchExecutions++;return investigationModule.runInvestigation(input,services,signal);}},enableFollowups:true,enableWatches:false,funding:{global:funds,trial:funds,demo:funds},
   providers:{search:unavailable,read:unavailable,model:async()=>{classificationCalls++;return{value:{route:'research_same_scope',scopeMatches:true,objectText:s.payload.scope.objectText},modelId:'controlled_fixture',providerRequestId:null,finishReason:'stop',usage:null};}},
   pricing:{quote:(_operation,input)=>{if(!('messages' in input))throw Error('controlled_fixture unused');return{provider:'controlled_fixture',purpose:'followup',attemptNo:1,priceRevision:'fixture-v1',timeoutMs:1000,estimated:{...zeroAmounts(),modelCalls:1,inputTokens:Buffer.byteLength(JSON.stringify(input.messages),'utf8')+512,outputTokens:input.maxOutputTokens,moneyMicros:10}};},actual:()=>({...zeroAmounts(),modelCalls:1,inputTokens:50,outputTokens:50,moneyMicros:1})},
  }});
 cleanup.push(async()=>{await app.close();s.db.close();rmSync(directory,{recursive:true,force:true});});
 const headers={origin:'http://127.0.0.1:5173',cookie:'detective_session='+token};
 async function poll(url:string){for(let step=0;step<150;step++){const response=await app.inject({url,headers});const data=response.json().data;if(data&&['completed','failed'].includes(data.status))return data;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('controlled_fixture followup did not finish');}
 const post=await app.inject({method:'POST',url:`/api/v1/investigations/${s.investigationId}/followups`,headers:{...headers,'idempotency-key':'controlled-budget-followup'},payload:{resultVersionId:version.id,question:exhaust==='interaction'?'这项活动的奖金金额是多少？':'请继续核对这项活动的报名截止日期'}});
 expect(post.statusCode).toBe(202);const turn=await poll('/api/v1/followups/'+post.json().data.followupTurnId);
 const grant=()=>app.inject({method:'POST',url:`/api/v1/investigations/${s.investigationId}/runs`,headers:{...headers,'idempotency-key':'controlled-budget-grant'},payload:{action:'add_budget',previousRunId:s.run.id,followupTurnId:turn.id}});
 return{...s,app,turn,grant,classificationCalls:()=>classificationCalls,researchExecutions:()=>researchExecutions};
}

it('never admits an unclassified new target when the interaction classification allowance is exhausted',async()=>{
 const s=await setup('interaction');expect(s.turn.turn.route).toBe('needs_budget_confirmation');expect(s.turn.researchPurpose).toBeNull();expect(s.classificationCalls()).toBe(0);
 const pools=s.db.prepare('SELECT count(*) n FROM budget_pools').get();
 const grant=await s.grant();expect(grant.statusCode).toBe(409);
 expect(s.db.prepare('SELECT count(*) n FROM runs').get()).toEqual({n:1});expect(s.researchExecutions()).toBe(0);expect(s.classificationCalls()).toBe(0);
 expect(s.db.prepare('SELECT count(*) n FROM budget_pools').get()).toEqual(pools);
 expect(s.db.prepare('SELECT count(*) n FROM followup_run_inputs').get()).toEqual({n:0});
 expect(s.db.prepare('SELECT count(*) n FROM host_submissions').get()).toEqual({n:0});
});
it('retains a classified same-scope purpose and admits an explicit new research window',async()=>{
 const s=await setup('research');expect(s.turn.turn.route).toBe('needs_budget_confirmation');expect(s.classificationCalls()).toBe(1);expect(s.turn.researchPurpose).toBeTruthy();
 const grant=await s.grant();expect(grant.statusCode).toBe(202);expect(grant.json().data.budgetWindowId).not.toBe(s.windowId);
});

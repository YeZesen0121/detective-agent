import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { budgetScenario } from '../helpers/budget-scenario.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { PaidCampaign } from '../../src/server/platform/paid-campaign.js';
import { PaidGateway } from '../../src/server/platform/gateway.js';
import { BudgetSnapshotSchema } from '../../src/shared/contracts.js';
import { newInvestigationAvailability } from '../../src/server/platform/research-availability.js';

const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();});

it('controlled_fixture unrestricted usage passes exhausted and paused task/global/campaign quotas while keeping actual and unknown accounting',async()=>{
 const s=budgetScenario();cleanup.push(()=>s.db.close());
 const grant={id:'controlled_fixture-unrestricted',moneyMicros:1,requestLimit:1,operationLimits:{search:1,read:0,model:0,tts:0},expiresAt:new Date(Date.now()+3600000).toISOString()};
 const limited=new BudgetBook(s.db,grant),first=s.reservation(1);
 limited.reserve(s.context,s.poolIds,first);limited.markSent(first.callId);limited.settle(first.callId,{...zeroAmounts(),searches:1,moneyMicros:2});
 const before=new PaidCampaign(s.db).inspect();
 const book=new BudgetBook(s.db,undefined,{unrestricted:true});
 // Existing books must see the persisted policy, not a constructor-local bypass.
 const snapshot=limited.snapshot(s.context,s.poolIds);
 expect(snapshot).toMatchObject({unrestricted:true,canSearch:true,canRead:true,canModel:true,blockedBy:[]});
 expect(BudgetSnapshotSchema.safeParse(snapshot).success).toBe(true);
 expect(newInvestigationAvailability(s.db,true,new Date().toISOString()).available).toBe(true);
 const gateway=new PaidGateway({book,poolIds:()=>s.poolIds,assertCurrent:()=>{},concurrency:{search:1,read:1,model:1,tts:1}});
 const ctx={...s.context,deadlineAt:'2020-01-01T00:00:00.000Z'};
 let sends=0;
 for(let index=0;index<14;index++)await gateway.invoke(ctx,{provider:'controlled_fixture',operation:'search',purpose:'controlled_fixture beyond old task and campaign caps',attemptNo:index+1,estimated:{...zeroAmounts(),searches:1,moneyMicros:3},priceRevision:'controlled_fixture-v1',timeoutMs:1000},async()=>{sends++;return{value:'controlled_fixture',actual:index===0?null:{...zeroAmounts(),searches:1,moneyMicros:3}};},new AbortController().signal);
 expect(sends).toBe(14);
 expect(new PaidCampaign(s.db).inspect()).toMatchObject({requestCount:15,unknownCount:1,settledMicros:41,heldMicros:3});
 expect(before).toMatchObject({requestCount:1,settledMicros:2});
 expect(book.inspectPool('global').used).toMatchObject({searches:14,moneyMicros:41});
 expect(book.inspectPool('global').reserved.moneyMicros).toBe(3);
 expect(()=>book.release(first.callId)).toThrow();
 expect(()=>book.reserve({...ctx,sessionId:randomUUID()},s.poolIds,s.reservation(3))).toThrow();
});

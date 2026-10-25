import { expect,it } from 'vitest';
import { runInvestigation } from '../../src/server/investigation/index.js';
import { scenario } from './controlled.js';

it('controlled_fixture unrestricted research can send after twelve searches and an old task deadline without retrying failed providers',async()=>{
 const s=scenario();
 const budget={...s.budget(),unrestricted:true,used:{...s.budget().used,searches:12},remaining:{...s.budget().remaining,searches:Number.MAX_SAFE_INTEGER}};
 s.setBudget(budget);
 s.input.context.deadlineAt='2020-01-01T00:00:00.000Z';
 let sent=0;s.services.search=async()=>{sent++;throw Error('controlled_fixture intentional stop');};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(sent).toBe(1);expect(result.stopReason).toBe('provider_error');
 expect(s.checkpoints.some(cp=>cp.queries.some(query=>query.attemptCount===13))).toBe(true);
});

it('controlled_fixture unrestricted research respects an explicit user cancellation',async()=>{
 const s=scenario(),budget={...s.budget(),unrestricted:true};s.setBudget(budget);
 const controller=new AbortController();controller.abort();
 const result=await runInvestigation(s.input,s.services,controller.signal);
 expect(s.searches).toHaveLength(0);expect(result.stopReason).toBe('cancelled');
});

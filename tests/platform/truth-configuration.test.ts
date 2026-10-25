import { expect, it } from 'vitest';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { truthRuntimeFromEnvironment } from '../../src/server/platform/truth-configuration.js';
const funds={...zeroAmounts(),moneyMicros:1000000,activeMs:420000,searches:12,reads:6,modelCalls:24,inputTokens:160000,outputTokens:24000};
it('keeps default startup offline and requires explicit finite funding before creating a real runtime',async()=>{
 expect(truthRuntimeFromEnvironment({})).toBeUndefined();
 expect(()=>truthRuntimeFromEnvironment({TRUTH_RUNTIME_ENABLED:'true'})).toThrow();
 expect(()=>truthRuntimeFromEnvironment({TRUTH_RUNTIME_ENABLED:'1',DEEPSEEK_API_KEY:'controlled_fixture_key',YUANBAO_API_KEY:'controlled_fixture_key'})).toThrow();
 const runtime=truthRuntimeFromEnvironment({TRUTH_RUNTIME_ENABLED:'1',DEEPSEEK_API_KEY:'controlled_fixture_key',YUANBAO_API_KEY:'controlled_fixture_key',
  RUNTIME_FUNDING_JSON:JSON.stringify({global:funds,trial:funds,demo:funds})});
 expect(runtime?.supportedBasicModes).toEqual(['truth','latest','identify']);expect(runtime?.enableWatches).toBe(true);expect(runtime?.enableFollowups).toBe(true);
 expect(runtime?.funding.trial).toEqual(funds);
});
it('rejects partial credentials, ambiguous search auth, negative or infinite budgets without leaking values',async()=>{
 const env={TRUTH_RUNTIME_ENABLED:'1',DEEPSEEK_API_KEY:'controlled_fixture_secret',TENCENT_SECRET_ID:'controlled_fixture_secret',RUNTIME_FUNDING_JSON:JSON.stringify({global:funds,trial:funds,demo:funds})};
 expect(()=>truthRuntimeFromEnvironment(env)).toThrow();
 expect(()=>truthRuntimeFromEnvironment({...env,TENCENT_SECRET_KEY:'controlled_fixture_secret',YUANBAO_API_KEY:'controlled_fixture_secret'})).toThrow();
 expect(()=>truthRuntimeFromEnvironment({...env,YUANBAO_API_KEY:'controlled_fixture_secret',RUNTIME_FUNDING_JSON:'{"global":"controlled_fixture_secret"}'})).toThrow();
 const bearer={TRUTH_RUNTIME_ENABLED:'1',DEEPSEEK_API_KEY:'controlled_fixture_key',YUANBAO_API_KEY:'controlled_fixture_key'};
 for(const moneyMicros of [-1,1e99])expect(()=>truthRuntimeFromEnvironment({...bearer,RUNTIME_FUNDING_JSON:JSON.stringify({global:{...funds,moneyMicros},trial:funds,demo:funds})})).toThrow();
 try{truthRuntimeFromEnvironment(env);}catch(error){expect(String(error)).not.toContain('controlled_fixture_secret');}
});

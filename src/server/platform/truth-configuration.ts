import { z } from 'zod';
import { BudgetAmountsSchema } from '../../shared/contracts.js';
import { createTruthRuntime } from './truth-runtime.js';
import type { InvestigationRuntimeOptions } from './host.js';

const FundingSchema=z.strictObject({global:BudgetAmountsSchema,trial:BudgetAmountsSchema,demo:BudgetAmountsSchema});
/** No I/O, no defaults for money or call counts, and no credential values in errors. */
export function truthRuntimeFromEnvironment(env:Record<string,string|undefined>):InvestigationRuntimeOptions|undefined {
 if(!env.TRUTH_RUNTIME_ENABLED||env.TRUTH_RUNTIME_ENABLED==='0')return undefined;
 if(env.TRUTH_RUNTIME_ENABLED!=='1')throw Error('TRUTH_RUNTIME_ENABLED must be 0 or 1');
 try {
  const funding=FundingSchema.parse(JSON.parse(env.RUNTIME_FUNDING_JSON??''));
  const bearer=env.YUANBAO_API_KEY?.trim(),id=env.TENCENT_SECRET_ID?.trim(),key=env.TENCENT_SECRET_KEY?.trim();
  const selected=env.SEARCH_AUTH_KIND?.trim();
  if(selected&&!['bearer','tc3'].includes(selected))throw Error('auth');
  if((selected==='bearer'&&!bearer)||(selected==='tc3'&&(!id||!key))||(!selected&&((bearer&&(id||key))||(!bearer&&(!id||!key)))))throw Error('auth');
  const useBearer=selected==='bearer'||(!selected&&!!bearer);
  return createTruthRuntime({funding,credentials:{search:useBearer?{kind:'bearer',apiKey:bearer!}:{kind:'tc3',secretId:id!,secretKey:key!},deepseekKey:env.DEEPSEEK_API_KEY??''}});
 }catch{throw Error('Truth runtime configuration invalid: check explicit RUNTIME_FUNDING_JSON, one search authentication method and DEEPSEEK_API_KEY.');}
}

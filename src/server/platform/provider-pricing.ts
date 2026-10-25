import { z } from 'zod';
import { zeroAmounts } from './budget.js';
import { ApiFault } from './errors.js';
import type { ResearchPricing } from './services.js';
import { ModelRequestSchema } from '../../shared/ports.js';
export const PriceRevisionSchema=z.strictObject({
 id:z.string().min(1).max(128),currency:z.literal('CNY'),validUntil:z.iso.datetime(),
 searchMicros:z.number().int().positive(),fetchMicros:z.number().int().positive(),
 inputMicrosPerToken:z.number().int().positive(),outputMicrosPerToken:z.number().int().positive(),
});
export const PRICE_20261024=Object.freeze({id:'2026-10-24-cny-conservative-v1',currency:'CNY' as const,validUntil:'2026-10-26T00:00:00.000Z',
 searchMicros:26000,fetchMicros:5000,inputMicrosPerToken:2,outputMicrosPerToken:8});
export function createProviderPricing(revision: z.infer<typeof PriceRevisionSchema>,now:()=>string):ResearchPricing {
 const price=PriceRevisionSchema.parse(revision);
 return {
  quote(operation,input) {
   if(Date.parse(now())>=Date.parse(price.validUntil))throw new ApiFault(503,'PROVIDER_UNAVAILABLE','价格版本已到期，请先核对配置。');
   const estimated=zeroAmounts();
   if(operation==='search'){estimated.searches=1;estimated.moneyMicros=price.searchMicros;}
   if(operation==='read'){estimated.reads=1;estimated.moneyMicros=price.fetchMicros;}
   if(operation==='model'){
    const request=ModelRequestSchema.parse(input);
    estimated.modelCalls=1;estimated.inputTokens=Buffer.byteLength(JSON.stringify(request.messages),'utf8')+512;estimated.outputTokens=request.maxOutputTokens;
    estimated.moneyMicros=estimated.inputTokens*price.inputMicrosPerToken+estimated.outputTokens*price.outputMicrosPerToken;
   }
   return {provider:operation==='search'?'yuanbao':'deepseek',purpose:'truth.'+operation,priceRevision:price.id,attemptNo:1,estimated,timeoutMs:operation==='model'?60000:25000};
  },
  actual(operation,response) {
   const amounts=zeroAmounts();
   if(operation==='search'){amounts.searches=1;amounts.moneyMicros=price.searchMicros;return amounts;}
   // A parsed HTTP success is not proof that an empty capture was free.
   if(operation==='read'){amounts.reads=1;amounts.moneyMicros=price.fetchMicros;return amounts;}
   if(!response.usage||response.usage.inputTokens<=0||response.usage.outputTokens<=0)return null;
   amounts.modelCalls=1;amounts.inputTokens=response.usage.inputTokens;amounts.outputTokens=response.usage.outputTokens;
   amounts.moneyMicros=amounts.inputTokens*price.inputMicrosPerToken+amounts.outputTokens*price.outputMicrosPerToken;return amounts;
  },
 };
}

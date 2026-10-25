import {
  ModelRequestSchema, ModelResponseSchema, ReadRequestSchema, ReadResponseSchema, SearchRequestSchema, SearchResponseSchema,
  type InvestigationServices,
} from '../../shared/ports.js';
import type { InvocationContext } from '../../shared/contracts.js';
import { ApiFault } from './errors.js';
import { PaidGateway, type CallSpec } from './gateway.js';
import { stableJson } from './snapshots.js';
export type ResearchOperation = 'search' | 'read' | 'model';
export type ResearchRequest = Parameters<InvestigationServices['search']>[0] | Parameters<InvestigationServices['read']>[0] | Parameters<InvestigationServices['model']>[0];
export type ResearchResponse = Awaited<ReturnType<InvestigationServices['search']>> | Awaited<ReturnType<InvestigationServices['read']>> | Awaited<ReturnType<InvestigationServices['model']>>;
export type RawResearchProviders = Pick<InvestigationServices, ResearchOperation> & {validateRead?(url:string,signal:AbortSignal):Promise<void>};
export interface ResearchPricing {
  quote(operation: ResearchOperation, input: ResearchRequest): Omit<CallSpec, 'operation'>;
  actual(operation: ResearchOperation, response: ResearchResponse): import('../../shared/contracts.js').BudgetAmounts | null;
}
export interface ResearchCallObserver {
 sent?(operation:ResearchOperation,input:ResearchRequest,callId:string):void;
 received?(operation:ResearchOperation,value:ResearchResponse,callId:string):void;
}
export function bindResearchServices(raw: RawResearchProviders, pricing: ResearchPricing, gateway: PaidGateway, context: InvocationContext, core: Omit<InvestigationServices, ResearchOperation>,observer?:ResearchCallObserver): InvestigationServices {
  const guard = (input: InvocationContext) => { if (stableJson(input) !== stableJson(context)) throw new ApiFault(409, 'INVALID_STATE', '业务调用不能改变任务上下文。'); };
  async function invoke<T extends ResearchResponse>(operation: ResearchOperation, input: ResearchRequest, ctx: InvocationContext, signal: AbortSignal, send: (signal: AbortSignal) => Promise<T>) {
    guard(ctx);
    const quote = pricing.quote(operation, input);
    if (operation === 'model') {
      const request = ModelRequestSchema.parse(input);
      if (request.messages.some(message => message.attachmentRefs?.length)) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '私有图片读取尚未接入。');
      const bytes = Buffer.byteLength(request.messages.map(message => message.content).join(''), 'utf8');
      if (quote.estimated.inputTokens < Math.max(1, bytes) || quote.estimated.outputTokens < request.maxOutputTokens) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '模型用量预留不足，不能发送。');
    }
    const receipt = await gateway.invoke(ctx, { ...quote, operation }, async (abort,callId) => {
      observer?.sent?.(operation,input,callId);
      const value = await send(abort);
      observer?.received?.(operation,value,callId);
      return { value, actual: pricing.actual(operation, value), ...('providerRequestId' in value && value.providerRequestId ? { providerRequestId: value.providerRequestId } : {}) };
    }, signal);
    return receipt.value;
  }
  return {
    ...core,
    search: async (input, ctx, signal) => {
      const parsed = SearchRequestSchema.parse(input);
      return invoke('search', parsed, ctx, signal, async abort => SearchResponseSchema.parse(await raw.search(parsed, ctx, abort)));
    },
    read: async (input, ctx, signal) => {
      const parsed = ReadRequestSchema.parse(input);
      guard(ctx);await raw.validateRead?.(parsed.url,signal);
      return invoke('read', parsed, ctx, signal, async abort => ReadResponseSchema.parse(await raw.read(parsed, ctx, abort)));
    },
    model: async (input, ctx, signal) => {
      const parsed = ModelRequestSchema.parse(input);
      return invoke('model', parsed, ctx, signal, async abort => ModelResponseSchema.parse(await raw.model(parsed, ctx, abort)));
    },
  };
}

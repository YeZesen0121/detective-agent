import type { ApiErrorCode, BudgetAmounts, StopReason } from '../../shared/contracts.js';

export class ApiFault extends Error {
  constructor(public readonly status: number, public readonly code: ApiErrorCode, message: string, public readonly retryable = false) {
    super(message);
  }
}

export class BudgetLimitFault extends ApiFault {
  constructor(readonly dimension: keyof BudgetAmounts | null) {
    super(409, 'BUDGET_EXHAUSTED', '本次调用超出剩余额度。');
  }
  get stopReason(): StopReason {
    return this.dimension === 'activeMs' ? 'time_limit' : this.dimension === 'searches' ? 'search_limit'
      : this.dimension === 'reads' ? 'read_limit' : this.dimension === 'modelCalls' ? 'model_limit'
      : this.dimension === 'inputTokens' || this.dimension === 'outputTokens' ? 'token_limit' : 'cost_limit';
  }
}

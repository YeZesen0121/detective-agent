import { z } from 'zod';
import { CountSchema, IdSchema, CompanionSegmentSchema, BudgetSnapshotSchema } from '../../shared/contracts.js';
import { ModelRequestSchema, type ExperienceServices, type ModelRequest } from '../../shared/ports.js';

export class CompanionError extends Error {
  constructor(readonly code: string, readonly publicMessage: string) { super(`${code}: ${publicMessage}`); }
}
export const fail = (code: string, message: string): never => { throw new CompanionError(code, message); };
export function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) fail('COMPANION_ABORTED', '伴读已停止，原报告和阅读位置保持不变。');
}
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail('COMPANION_INVALID_INPUT', '无法读取这份伴读，请核对报告版本和阅读位置。');
  return parsed.data;
}
export function parseOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail('COMPANION_INVALID_OUTPUT', '伴读生成格式有误，本次内容未保存，原报告不受影响。');
  return parsed.data;
}
const text = (max: number) => z.string().trim().min(1).max(max);
export const DraftOutputSchema = z.strictObject({
  segments: z.array(CompanionSegmentSchema.extend({ text: text(1200) })).min(3).max(5), summary: text(1200),
});
export const TurnOutputSchema = z.strictObject({
  kind: z.enum(['answer', 'research_request', 'finish']), text: text(1200),
  claimIds: z.array(IdSchema).max(80), evidenceIds: z.array(IdSchema).max(400),
  resumeCursor: CountSchema.optional(), followupQuestion: text(2000).nullable().optional(),
});
export async function modelValue(request: ModelRequest, services: ExperienceServices, context: Parameters<ExperienceServices['model']>[1], signal: AbortSignal) {
  assertNotAborted(signal);
  if (!ModelRequestSchema.safeParse(request).success) fail('COMPANION_MATERIAL_TOO_LONG', '这份报告的伴读材料过长，请先阅读原报告或证据卡。');
  let budget;
  try { budget = BudgetSnapshotSchema.parse(await services.budget.snapshot(context)); }
  catch { assertNotAborted(signal); return fail('COMPANION_BUDGET_UNAVAILABLE', '暂时无法核对伴读余额，本次没有调用模型，请继续阅读原报告。'); }
  assertNotAborted(signal);
  // P reserves a conservative UTF8 bound, not a locally guessed tokenizer count.
  if (Buffer.byteLength(JSON.stringify(request.messages), 'utf8') + 512 > Math.min(24000, budget.remaining.inputTokens)) {
    fail('COMPANION_MATERIAL_TOO_LONG', '必要引用和限定超出本次伴读输入额度，请阅读原报告或证据卡；本次没有截断材料。');
  }
  if (!budget.canModel || budget.remaining.modelCalls < 1 || budget.remaining.outputTokens < request.maxOutputTokens) {
    fail('COMPANION_BUDGET_EXHAUSTED', '本次伴读的模型或输出额度不足，请继续阅读原报告。');
  }
  try {
    const response = await services.model(request, context, signal);
    assertNotAborted(signal);
    if (response.finishReason !== 'stop') fail('COMPANION_INCOMPLETE_OUTPUT', '伴读内容未生成完整，本次没有保存。');
    return response.value;
  } catch (error) {
    assertNotAborted(signal);
    if (error instanceof CompanionError) throw error;
    fail('COMPANION_PROVIDER_FAILED', '伴读生成失败，可以继续阅读原报告；本次没有自动重试。');
  }
}

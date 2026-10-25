import { z } from 'zod';
import { BudgetAmountsSchema, BudgetSnapshotSchema, ClarificationSchema, IdSchema, ProgressEventSchema, ResultVersionSchema, RunSchema, TimestampSchema } from './contracts.js';
export const StartRunSchema = z.strictObject({ action: z.enum(['start', 'resume', 'add_budget']), previousRunId: IdSchema.nullable(), followupTurnId: IdSchema.optional() })
  .refine(input => input.followupTurnId === undefined || input.action === 'add_budget', 'A followup grant requires explicit add_budget');
export const ClarificationAnswerSchema = z.strictObject({ answer: z.string().trim().min(1).max(2000).nullable(), proceedWithUnknown: z.boolean() });
export const StartedRunSchema = z.strictObject({ runId: IdSchema, status: RunSchema.shape.status, budgetWindowId: IdSchema, limits: BudgetAmountsSchema });
export const RunViewSchema = z.strictObject({ run: RunSchema, remainingBudget: BudgetSnapshotSchema, clarification: ClarificationSchema.nullable(), partialMaterialSummary: z.string().nullable() });
export const EventsPageSchema = z.strictObject({ items: z.array(ProgressEventSchema).max(100), nextSeq: z.number().int().nonnegative(), hasMore: z.boolean() });
export const UpdateNoticeSchema = z.strictObject({ latestResultVersionId: IdSchema, createdAt: TimestampSchema });
export const ResultViewSchema = z.strictObject({ version: ResultVersionSchema, updateNotice: UpdateNoticeSchema.nullable() });
export const CancelledRunSchema = z.strictObject({ runId: IdSchema, cancelRequestedAt: TimestampSchema.nullable(), status: RunSchema.shape.status });
export const AnsweredRunSchema = z.strictObject({ runId: IdSchema, status: RunSchema.shape.status });
export const CopyResultSchema = z.strictObject({ text: z.string().min(1) });

import { z } from 'zod';
import { FollowupTurnSchema, IdSchema, TimestampSchema } from './contracts.js';
export const CreateFollowupSchema = z.strictObject({ resultVersionId: IdSchema, question: z.string().trim().min(1).max(2000) });
export const AcceptedFollowupSchema = z.strictObject({ followupTurnId: IdSchema });
export const FollowupSubmissionSchema = z.strictObject({ submission: AcceptedFollowupSchema.nullable() });
export const FollowupViewSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, resultVersionId: IdSchema, question: z.string().min(1).max(2000), createdAt: TimestampSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed']), turn: FollowupTurnSchema.nullable(),
  evidenceIds: z.array(IdSchema).max(400), researchPurpose: z.string().nullable(), suggestedQuestion: z.string().nullable(),
  activeRunId: IdSchema.nullable(), latestResultVersionId: IdSchema.nullable(),
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
});
export const FollowupsPageSchema = z.strictObject({ items: z.array(FollowupViewSchema).max(50), nextAfter: z.number().int().nonnegative().nullable() });

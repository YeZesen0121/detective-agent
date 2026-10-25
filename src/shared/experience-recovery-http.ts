import { z } from 'zod';
import { IdSchema, TimestampSchema } from './contracts.js';
import { CompanionViewSchema, TurnViewSchema } from './experience-http.js';

export const MediaOperationSchema = z.enum(['attachment', 'companion', 'turn', 'audio']);
export const MediaSubmissionQuerySchema = z.strictObject({ operation: MediaOperationSchema });
export const MediaSubmissionViewSchema = z.strictObject({ submission: z.discriminatedUnion('operation', [
  z.strictObject({ operation:z.literal('attachment'), attachmentId:IdSchema, deleted:z.boolean() }),
  z.strictObject({ operation:z.literal('companion'), companionSessionId:IdSchema, resultVersionId:IdSchema }),
  z.strictObject({ operation:z.literal('turn'), turnId:IdSchema, companionSessionId:IdSchema, resultVersionId:IdSchema }),
  z.strictObject({ operation:z.literal('audio'), audioJobId:IdSchema, companionSessionId:IdSchema, resultVersionId:IdSchema }),
]).nullable() });

// Opaque, ascending database cursor. Clients preserve it; never derive it from array indexes.
export const ExperienceHistoryQuerySchema = z.strictObject({
  after:z.string().regex(/^(0|[1-9][0-9]*)$/).pipe(z.coerce.number<string>().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).optional(),
});
const nextAfter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const CompanionHistoryPageSchema = z.strictObject({items:z.array(CompanionViewSchema).max(50),nextAfter});
export const CompanionTurnHistoryItemSchema = z.strictObject({
  turnId:IdSchema, question:z.string().min(1).max(2000), createdAt:TimestampSchema, view:TurnViewSchema,
});
export const CompanionTurnHistoryPageSchema = z.strictObject({items:z.array(CompanionTurnHistoryItemSchema).max(50),nextAfter});

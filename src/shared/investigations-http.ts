import {z} from 'zod';
import {IdSchema,BasicModeSchema,PresentationModeSchema,InvestigationStatusSchema,TimestampSchema} from './contracts.js';
export const ListInvestigationsQuerySchema=z.strictObject({limit:z.coerce.number().int().min(1).max(50).default(20),before:IdSchema.optional()});
export const InvestigationSummarySchema=z.strictObject({id:IdSchema,originalQuestion:z.string().min(1).max(4000),basicMode:BasicModeSchema,presentationMode:PresentationModeSchema,status:InvestigationStatusSchema,latestResultVersionId:IdSchema.nullable(),createdAt:TimestampSchema,updatedAt:TimestampSchema});
export const InvestigationsPageSchema=z.strictObject({items:z.array(InvestigationSummarySchema).max(50),nextBefore:IdSchema.nullable()});
export type InvestigationsPage=z.infer<typeof InvestigationsPageSchema>;
/** Content is erased now; accounting stays and private files are reclaimed by existing GC. */
export const DeleteInvestigationResponseSchema=z.strictObject({investigationId:IdSchema,deleted:z.literal(true),billingAuditRetained:z.literal(true),mediaCleanup:z.enum(['not_needed','managed_by_existing_gc'])});
export type DeleteInvestigationResponse=z.infer<typeof DeleteInvestigationResponseSchema>;

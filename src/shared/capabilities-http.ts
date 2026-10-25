import { z } from 'zod';
import { BasicModeSchema } from './contracts.js';
export const NewInvestigationAvailabilitySchema=z.strictObject({available:z.boolean(),reason:z.enum(['model_limit','request_limit','cost_limit','expired','paused','unconfigured']).nullable(),message:z.string().min(1).max(300).nullable()});

/** Operational availability only; never a claim that product acceptance has passed. */
export const RuntimeCapabilitiesSchema=z.strictObject({
 basicModes:z.array(BasicModeSchema).max(3).refine(modes=>new Set(modes).size===modes.length),
 followups:z.boolean(),watches:z.boolean(),vision:z.boolean(),companion:z.boolean(),audio:z.boolean(),
 newInvestigations:NewInvestigationAvailabilitySchema.optional(),
 unrestrictedUsage:z.boolean().optional(),
});
export type RuntimeCapabilities=z.infer<typeof RuntimeCapabilitiesSchema>;

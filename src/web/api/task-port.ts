import { z } from 'zod';
import { CountSchema, type Run } from '../../shared/contracts.js';
import { RunViewSchema, EventsPageSchema } from '../../shared/runtime-http.js';

// Normalized consumer port. HTTP mapping lives in task-http.ts and reuses P's published shapes.
export { RunViewSchema };
// Browser cursors must also be safely representable; P's HTTP input enforces the same bound.
export const EventPageSchema = EventsPageSchema.extend({ nextSeq: CountSchema });
export type RunView = z.infer<typeof RunViewSchema>;
export interface TaskPort {
  getRun(runId: string, signal: AbortSignal): Promise<RunView>;
  getEvents(investigationId: string, afterSeq: number, signal: AbortSignal): Promise<z.infer<typeof EventPageSchema>>;
  cancel(runId: string, key: string, signal: AbortSignal): Promise<Run>;
}

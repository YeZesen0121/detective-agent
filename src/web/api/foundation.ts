import { z } from 'zod';
import {
  AccessGroupSchema, BudgetAmountsSchema, CreateInvestigationSchema, IdSchema,
  InvestigationPublicSchema, RunSchema, TimestampSchema, type CreateInvestigation,
  type InvestigationPublic,
} from '../../shared/contracts.js';
import { parseInput, request } from './client.js';

// G0 app.ts exposes these shapes but does not export response parsers yet.
export const SessionViewSchema = z.strictObject({
  accessGroup: AccessGroupSchema, expiresAt: TimestampSchema,
  serviceEndsAt: TimestampSchema, limits: BudgetAmountsSchema,
});
export const InvestigationViewSchema = z.strictObject({
  investigation: InvestigationPublicSchema, activeRun: RunSchema.nullable(), latestResultVersionId: IdSchema.nullable(),
});
export type SessionView = z.infer<typeof SessionViewSchema>;
export type InvestigationView = z.infer<typeof InvestigationViewSchema>;
export interface FoundationApi {
  createSession(code: string, signal: AbortSignal): Promise<SessionView>;
  getSession(signal: AbortSignal): Promise<SessionView>;
  createInvestigation(input: CreateInvestigation, key: string, signal: AbortSignal): Promise<InvestigationPublic>;
  getInvestigation(id: string, signal: AbortSignal): Promise<InvestigationView>;
}
export function createFoundationApi(transport: typeof fetch): FoundationApi {
  return {
    async createSession(code, signal) {
      const input = parseInput(z.strictObject({ code: z.string().min(1).max(256) }), { code });
      return request('/api/v1/sessions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, SessionViewSchema, transport);
    },
    getSession: (signal) => request('/api/v1/session', { signal }, SessionViewSchema, transport),
    async createInvestigation(input, key, signal) {
      const body = parseInput(CreateInvestigationSchema, input);
      const validatedKey = parseInput(z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/), key);
      // No automatic POST retry and no key generation: caller owns one key per logical creation.
      return request('/api/v1/investigations', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': validatedKey }, body: JSON.stringify(body) }, InvestigationPublicSchema, transport);
    },
    async getInvestigation(id, signal) {
      const validatedId = parseInput(IdSchema, id);
      return request(`/api/v1/investigations/${validatedId}`, { signal }, InvestigationViewSchema, transport);
    },
  };
}

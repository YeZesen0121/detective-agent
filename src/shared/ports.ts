import { z } from 'zod';
import {
  AudioManifestSchema, BasicModeSchema, BudgetSnapshotSchema, CandidateSchema,
  ChangeSchema, ClaimSchema, ClarificationSchema, CompanionSegmentSchema, CompanionSessionSchema,
  CountSchema, EvidenceSchema, ExtractionSchema, FollowupRouteSchema, HashSchema, HttpUrlSchema,
  IdSchema, InvocationContextSchema, ProgressEventSchema, ReadStatusSchema, ResultPayloadSchema,
  ResultVersionSchema, RunSchema, ScopeSchema, SearchQuerySchema, SourceSchema, StopReasonSchema,
  TimestampSchema, UsageSchema,
  type BudgetSnapshot, type InvocationContext, type ProgressEvent,
} from './contracts.js';

const text = (max = 4000) => z.string().trim().min(1).max(max);
const ids = () => z.array(IdSchema).max(400);
/** Only the runtime adapter emits this after one source failed; never authorizes retrying that source. */
export class SourceReadUnavailableError extends Error {
  constructor(){super('SOURCE_READ_UNAVAILABLE');this.name='SourceReadUnavailableError';}
}
export const WorkingMaterialSchema = z.strictObject({
  sources: z.array(SourceSchema), evidence: z.array(EvidenceSchema),
  claims: z.array(ClaimSchema).max(80), candidates: z.array(CandidateSchema).max(20),
  queries: z.array(SearchQuerySchema),
});
export const PreparationInputSchema = z.strictObject({
  context: InvocationContextSchema, originalQuestion: text(), basicMode: BasicModeSchema,
  attachments: z.array(ExtractionSchema).max(3), previousScope: ScopeSchema.nullable(),
  followup: z.strictObject({kind:z.literal('saved_followup'),turnId:IdSchema,resultVersionId:IdSchema,question:text(2000)}).optional(),
  clarificationAnswer: z.strictObject({ clarificationId: IdSchema, answer: text(2000).nullable(), proceedWithUnknown: z.boolean() }).nullable(),
});
export const PreparationOutcomeSchema = z.strictObject({
  scope: ScopeSchema.nullable(), clarification: ClarificationSchema.nullable(), canInvestigate: z.boolean(),
}).refine((outcome) => outcome.canInvestigate
  ? outcome.scope !== null && outcome.clarification === null
  : outcome.clarification !== null, 'Preparation must resolve scope or request necessary clarification');
export const InvestigationInputSchema = z.strictObject({
  context: InvocationContextSchema, run: RunSchema, scope: ScopeSchema, basicMode: BasicModeSchema,
  attachments: z.array(ExtractionSchema).max(3), checkpoint: WorkingMaterialSchema.nullable(),
  baseline: ResultVersionSchema.nullable(), intent: z.enum(['initial', 'followup', 'watch']), followupQuestion: text(2000).nullable(),
}).refine((input) => input.context.runId === input.run.id
  && input.context.investigationId === input.run.investigationId
  && input.context.epoch === input.run.epoch
  && input.basicMode === input.scope.basicMode, 'Run context or scope mismatch');
export const InvestigationOutcomeSchema = z.strictObject({
  stopReason: StopReasonSchema, completion: z.enum(['completed', 'partial', 'failed', 'waiting_for_user']),
  draft: ResultPayloadSchema.nullable(), clarification: ClarificationSchema.nullable(),
}).refine((outcome) => {
  if (outcome.completion === 'waiting_for_user') return outcome.draft === null && outcome.clarification !== null && outcome.stopReason === 'needs_user';
  if (outcome.completion === 'failed') return outcome.draft === null && outcome.clarification === null;
  return outcome.draft !== null && outcome.clarification === null && outcome.draft.stopReason === outcome.stopReason;
}, 'Outcome cannot both finalize and wait for the user');
export const FollowupInputSchema = z.strictObject({
  context: InvocationContextSchema, version: ResultVersionSchema, question: text(2000), remainingBudget: BudgetSnapshotSchema,
});
export const FollowupDecisionSchema = z.strictObject({
  route: FollowupRouteSchema,
  answer: z.strictObject({ text: text(12000), claimIds: ids(), evidenceIds: ids() }).nullable(),
  researchPurpose: text().nullable(), suggestedQuestion: text().nullable(),
});
export const ExtractionInputSchema = z.strictObject({
  context: InvocationContextSchema,
  attachments: z.array(z.strictObject({
    id: IdSchema, mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), bytesRef: text(),
    order: z.number().int().min(0).max(2), width: CountSchema.positive(), height: CountSchema.positive(),
  })).min(1).max(3),
});
export const ExtractionBatchSchema = z.strictObject({
  items: z.array(ExtractionSchema).max(3),
  failed: z.array(z.strictObject({ attachmentId: IdSchema, errorCode: text(128) })).max(3),
  blockingQuestions: z.array(text()).max(10),
}).refine((batch) => {
  const all = [...batch.items.map((item) => item.attachmentId), ...batch.failed.map((item) => item.attachmentId)];
  return new Set(all).size === all.length && all.length <= 3;
}, 'An attachment can have exactly one extraction outcome');
export const PersonaSchema = z.strictObject({ id: text(128), version: text(128), name: text(128), traits: z.array(text(256)).max(20), style: text() });
export const CompanionInputSchema = z.strictObject({ context: InvocationContextSchema, version: ResultVersionSchema, persona: PersonaSchema });
export const CompanionDraftSchema = z.strictObject({
  resultVersionId: IdSchema, personaVersion: text(128), segments: z.array(CompanionSegmentSchema).min(1).max(100), summary: text(12000),
});
export const CompanionTurnInputSchema = z.strictObject({
  context: InvocationContextSchema, session: CompanionSessionSchema, version: ResultVersionSchema, question: text(2000),
}).refine((input) => input.session.resultVersionId === input.version.id
  && input.session.investigationId === input.version.investigationId
  && input.context.investigationId === input.version.investigationId, 'Companion is bound to its saved version');
export const CompanionReplySchema = z.strictObject({
  kind: z.enum(['answer', 'research_request', 'finish']), text: text(12000), claimIds: ids(), evidenceIds: ids(),
  resumeCursor: CountSchema, followupQuestion: text(2000).nullable(),
}).refine((reply) => reply.kind !== 'research_request' || reply.followupQuestion !== null, 'Research request needs a followup question');
export const SpeechInputSchema = z.strictObject({
  context: InvocationContextSchema, resultVersionId: IdSchema, companionSessionId: IdSchema,
  segmentId: IdSchema, text: text(12000), voiceId: text(128), speed: z.literal(0),
});
export const WatchComparisonInputSchema = z.strictObject({
  context: InvocationContextSchema, before: ResultVersionSchema, candidate: ResultPayloadSchema, focus: text(),
  readFailures: z.array(z.strictObject({ sourceId: IdSchema, errorCode: text(128) })).max(120),
}).refine((input) => input.before.investigationId === input.candidate.investigationId
  && input.context.investigationId === input.candidate.investigationId, 'Watch comparison must stay in the same investigation');
export const WatchDecisionSchema = z.strictObject({
  kind: z.enum(['significant', 'unchanged', 'unknown']), changes: z.array(ChangeSchema).max(100), reason: text(), factSignature: HashSchema,
}).refine((decision) => decision.kind !== 'significant' || decision.changes.length > 0, 'Significant change needs evidence');

export const SearchRequestSchema = z.strictObject({
  query: text(1000), purpose: text(1000), claimIds: ids(), site: text(256).nullable(), freshness: text(128).nullable(), limit: z.number().int().min(1).max(20),
});
export const SearchResponseSchema = z.strictObject({
  items: z.array(z.strictObject({
    url: HttpUrlSchema, title: text(), snippet: z.string().max(24000), publisher: text().nullable(),
    publishedAt: TimestampSchema.nullable(), providerScore: z.number().finite().nullable(),
  })).max(20), providerRequestId: text(256).nullable(), invalidItemCount: CountSchema,
  warnings: z.array(text()).max(40), usage: UsageSchema.nullable(),
});
export const ReadRequestSchema = z.strictObject({ url: HttpUrlSchema, sourceId: IdSchema });
export const ReadResponseSchema = z.strictObject({
  sourceId: IdSchema, finalUrl: HttpUrlSchema, title: text().nullable(), text: text(24000).nullable(),
  readStatus: ReadStatusSchema, fetchedAt: TimestampSchema, contentHash: HashSchema.nullable(),
  failureCode: text(128).nullable(), usage: UsageSchema.nullable(),
});
export const ModelRequestSchema = z.strictObject({
  purpose: z.enum(['scope', 'plan', 'extract', 'evaluate', 'finalize', 'followup', 'companion', 'watch_compare']),
  promptVersion: text(128), schemaId: text(128),
  messages: z.array(z.strictObject({
    role: z.enum(['system', 'user', 'assistant']), content: z.string().max(96000),
    attachmentRefs: z.array(z.strictObject({ id: IdSchema, bytesRef: text(), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']) })).max(3).optional(),
  })).min(1).max(100), maxOutputTokens: z.number().int().positive().max(2500),
});
export const ModelResponseSchema = z.strictObject({
  value: z.json(), usage: UsageSchema.nullable(), providerRequestId: text(256).nullable(), modelId: text(128), finishReason: text(128),
});
export const TTSRequestSchema = z.strictObject({ text: text(150), voiceId: text(128), speed: z.literal(0), codec: z.literal('mp3') });
// Binary transport is private to the server; do not serialize this schema into HTTP responses.
export const TTSResponseSchema = z.strictObject({
  audioBytes: z.instanceof(Uint8Array), contentType: z.literal('audio/mpeg'),
  providerRequestId: text(256).nullable(), billedCharacters: CountSchema.nullable(), usage: UsageSchema.nullable(),
});

export type PreparationInput = z.infer<typeof PreparationInputSchema>;
export type PreparationOutcome = z.infer<typeof PreparationOutcomeSchema>;
export type InvestigationInput = z.infer<typeof InvestigationInputSchema>;
export type InvestigationOutcome = z.infer<typeof InvestigationOutcomeSchema>;
export type FollowupInput = z.infer<typeof FollowupInputSchema>;
export type FollowupDecision = z.infer<typeof FollowupDecisionSchema>;
export type ExtractionInput = z.infer<typeof ExtractionInputSchema>;
export type ExtractionBatch = z.infer<typeof ExtractionBatchSchema>;
export type CompanionInput = z.infer<typeof CompanionInputSchema>;
export type CompanionDraft = z.infer<typeof CompanionDraftSchema>;
export type CompanionTurnInput = z.infer<typeof CompanionTurnInputSchema>;
export type CompanionReply = z.infer<typeof CompanionReplySchema>;
export type SpeechInput = z.infer<typeof SpeechInputSchema>;
export type WatchComparisonInput = z.infer<typeof WatchComparisonInputSchema>;
export type WatchDecision = z.infer<typeof WatchDecisionSchema>;
export type WorkingMaterial = z.infer<typeof WorkingMaterialSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type ReadRequest = z.infer<typeof ReadRequestSchema>;
export type ReadResponse = z.infer<typeof ReadResponseSchema>;
export type ModelRequest = z.infer<typeof ModelRequestSchema>;
export type ModelResponse = z.infer<typeof ModelResponseSchema>;
export type TTSRequest = z.infer<typeof TTSRequestSchema>;
export type TTSResponse = z.infer<typeof TTSResponseSchema>;

interface CoreServices {
  model(input: ModelRequest, context: InvocationContext, signal: AbortSignal): Promise<ModelResponse>;
  budget: { snapshot(context: InvocationContext): Promise<BudgetSnapshot> };
  checkpoint: { save(runId: string, epoch: number, patch: Partial<WorkingMaterial>): Promise<void> };
  events: { append(runId: string, epoch: number, event: Omit<ProgressEvent, 'id' | 'seq' | 'at' | 'investigationId' | 'runId'>): Promise<void> };
  clock: { now(): string };
}
export interface InvestigationServices extends CoreServices {
  search(input: SearchRequest, context: InvocationContext, signal: AbortSignal): Promise<SearchResponse>;
  read(input: ReadRequest, context: InvocationContext, signal: AbortSignal): Promise<ReadResponse>;
}
export interface ExperienceServices extends CoreServices {
  tts(input: TTSRequest, context: InvocationContext, signal: AbortSignal): Promise<TTSResponse>;
  /** Host-bound persistence; pass the unmodified receipt returned by this job's tts call. */
  audio?: {
    readonly jobId: string;
    saveChunk(index: number, receipt: TTSResponse): Promise<{ index: number; assetId: string }>;
  };
}
export interface InvestigationModule {
  prepareInvestigation(input: PreparationInput, services: InvestigationServices, signal: AbortSignal): Promise<PreparationOutcome>;
  runInvestigation(input: InvestigationInput, services: InvestigationServices, signal: AbortSignal): Promise<InvestigationOutcome>;
  routeFollowup(input: FollowupInput, services: InvestigationServices, signal: AbortSignal): Promise<FollowupDecision>;
  compareWatchResult(input: WatchComparisonInput, services: InvestigationServices, signal: AbortSignal): Promise<WatchDecision>;
}
export interface ExperienceModule {
  extractAttachments(input: ExtractionInput, services: ExperienceServices, signal: AbortSignal): Promise<ExtractionBatch>;
  buildCompanion(input: CompanionInput, services: ExperienceServices, signal: AbortSignal): Promise<CompanionDraft>;
  answerCompanion(input: CompanionTurnInput, services: ExperienceServices, signal: AbortSignal): Promise<CompanionReply>;
  synthesizeSegment(input: SpeechInput, services: ExperienceServices, signal: AbortSignal): Promise<z.infer<typeof AudioManifestSchema>>;
}

import { z } from 'zod';

export const CONTRACT_VERSION = '0.1.0' as const;
export const IdSchema = z.uuid();
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max = 4000) => z.string().trim().min(1).max(max);
const texts = (max = 80) => z.array(text()).max(max);
const ids = (max = 400) => z.array(IdSchema).max(max);
export const TimestampSchema = z.iso.datetime().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}, 'Invalid calendar date');
export const HttpUrlSchema = z.url().max(4096).refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Only HTTP(S) URLs without credentials are allowed');

export const BasicModeSchema = z.enum(['truth', 'latest', 'identify']);
export const PresentationModeSchema = z.enum(['brief', 'evidence', 'companion']);
export const AccessGroupSchema = z.enum(['trial', 'demo']);
export const InvestigationStatusSchema = z.enum(['draft', 'clarifying', 'running', 'waiting_for_user', 'completed', 'partial', 'failed', 'cancelled', 'interrupted']);
export const RunStatusSchema = z.enum(['queued', 'running', 'waiting_for_user', 'completed', 'partial', 'failed', 'cancelled', 'interrupted']);
export const RunTriggerSchema = z.enum(['initial', 'followup', 'resume', 'watch']);
export const StageSchema = z.enum(['extracting', 'planning', 'searching', 'reading', 'evaluating', 'finalizing']);
export const FactStatusSchema = z.enum(['supported', 'refuted', 'mixed', 'insufficient']);
export const ReadStatusSchema = z.enum(['full', 'partial', 'snippet_only', 'inaccessible']);
export const EvidenceRelationSchema = z.enum(['supports', 'contradicts', 'qualifies', 'background']);
export const StopReasonSchema = z.enum(['answered', 'no_useful_direction', 'needs_user', 'time_limit', 'search_limit', 'read_limit', 'model_limit', 'token_limit', 'cost_limit', 'cancelled', 'provider_error', 'invalid_output', 'server_restart']);
export const WatchStatusSchema = z.enum(['active', 'paused', 'budget_paused', 'expired', 'deleted']);
export const WatchCheckStatusSchema = z.enum(['queued', 'running', 'unchanged', 'changed', 'unknown', 'failed', 'interrupted', 'cancelled']);
export const CallStatusSchema = z.enum(['reserved', 'sent', 'settled', 'failed', 'unknown', 'released']);
export const FollowupRouteSchema = z.enum(['explain', 'research_same_scope', 'suggest_new_case', 'needs_budget_confirmation']);
export const AudioStatusSchema = z.enum(['queued', 'generating', 'ready', 'partial', 'failed', 'cancelled']);

export const BudgetAmountsSchema = z.strictObject({
  activeMs: CountSchema, searches: CountSchema, reads: CountSchema, modelCalls: CountSchema,
  inputTokens: CountSchema, outputTokens: CountSchema, moneyMicros: CountSchema,
});
export const BudgetSnapshotSchema = z.strictObject({
  unrestricted: z.boolean().optional(),
  limits: BudgetAmountsSchema, used: BudgetAmountsSchema, reserved: BudgetAmountsSchema,
  remaining: BudgetAmountsSchema, canSearch: z.boolean(), canRead: z.boolean(),
  canModel: z.boolean(), blockedBy: texts(16),
});
export const BudgetWindowSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, kind: z.enum(['research', 'watch']),
  grantedBy: z.enum(['initial', 'user_continue', 'watch_policy']), limits: BudgetAmountsSchema,
  used: BudgetAmountsSchema, reserved: BudgetAmountsSchema, activeMs: CountSchema, createdAt: TimestampSchema,
});
export const BrowserSessionSchema = z.strictObject({
  id: IdSchema, tokenHash: HashSchema, accessGroup: AccessGroupSchema,
  createdAt: TimestampSchema, expiresAt: TimestampSchema, revokedAt: TimestampSchema.nullable(),
});
export const ScopeSchema = z.strictObject({
  objectText: text(), goal: text(), basicMode: BasicModeSchema,
  knownClues: texts(), uncertainClues: texts(), claimsToCheck: texts(),
  timeScope: text().nullable(), region: text().nullable(), referenceTime: TimestampSchema, userConfirmed: z.boolean(),
});
export const CreateInvestigationSchema = z.strictObject({
  originalQuestion: text(4000), basicMode: BasicModeSchema, presentationMode: PresentationModeSchema,
});
export const InvestigationSchema = z.strictObject({
  id: IdSchema, sessionId: IdSchema, originalQuestion: text(4000), basicMode: BasicModeSchema,
  presentationMode: PresentationModeSchema, scope: ScopeSchema.nullable(), scopeVersion: CountSchema,
  status: InvestigationStatusSchema, attachmentIds: ids(3), activeRunId: IdSchema.nullable(),
  latestResultVersionId: IdSchema.nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
});
export const InvestigationPublicSchema = InvestigationSchema.omit({ sessionId: true });
export const RunSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, trigger: RunTriggerSchema, previousRunId: IdSchema.nullable(),
  budgetWindowId: IdSchema, scopeVersion: CountSchema, status: RunStatusSchema, stage: StageSchema.nullable(),
  epoch: CountSchema, queuedAt: TimestampSchema, startedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema.nullable(), activeIntervals: z.array(z.strictObject({
    startedAt: TimestampSchema, endedAt: TimestampSchema.nullable(),
  })).max(1000), activeMs: CountSchema, stopReason: StopReasonSchema.nullable(),
  cancelRequestedAt: TimestampSchema.nullable(), checkpointRef: text().nullable(), createdResultVersionId: IdSchema.nullable(),
});
export const IdempotencyRecordSchema = z.strictObject({
  sessionId: IdSchema, operation: text(128), key: z.string().min(8).max(128),
  bodyHash: HashSchema, responseRef: text(), createdAt: TimestampSchema, expiresAt: TimestampSchema,
});
export const ClarificationSchema = z.strictObject({
  id: IdSchema, runId: IdSchema, prompt: text(), missingFields: texts(20), options: texts(10),
  canProceedWithUnknown: z.boolean(), answer: text(2000).nullable(), answeredAt: TimestampSchema.nullable(),
});
export const SearchQuerySchema = z.strictObject({
  id: IdSchema, runId: IdSchema, query: text(1000), purpose: text(1000), claimIds: ids(80),
  site: text(256).nullable(), freshness: text(128).nullable(), limit: z.number().int().min(1).max(20),
  scopeVersion: CountSchema, batchNo: z.number().int().positive().safe(), attemptCount: z.number().int().positive().safe(),
  budgetWindowId: IdSchema.optional(),
});
export const SourceSchema = z.strictObject({
  id: IdSchema, url: HttpUrlSchema, canonicalUrl: HttpUrlSchema, title: text(),
  publisher: text().nullable(), publishedAt: TimestampSchema.nullable(), eventAt: TimestampSchema.nullable(),
  fetchedAt: TimestampSchema.nullable(), readStatus: ReadStatusSchema, originGroup: text().nullable(),
  originReason: text().nullable(), queryIds: ids(12), snippet: text(24000).nullable(),
  contentHash: HashSchema.nullable(), diagnostic: text().nullable(),
});
export const EvidenceSchema = z.strictObject({
  id: IdSchema, origin: z.strictObject({ kind: z.enum(['source', 'attachment']), id: IdSchema }),
  representation: z.enum(['verbatim', 'snippet', 'extracted']), excerpt: text(24000),
  locator: z.strictObject({ kind: z.enum(['paragraph', 'char_range', 'image_region', 'description']), value: text() }),
  capturedAt: TimestampSchema, contentHash: HashSchema, limitations: texts(20),
});
export const EvidenceLinkSchema = z.strictObject({ evidenceId: IdSchema, relation: EvidenceRelationSchema, rationale: text(1000), quote:text().optional() });
export const ClaimSchema = z.strictObject({
  id: IdSchema, statement: text(), conditions: texts(), status: FactStatusSchema,
  links: z.array(EvidenceLinkSchema).max(80), gaps: texts(), reasonSummary: text(),
});
export const CandidateSchema = z.strictObject({
  id: IdSchema, name: text(256), aliases: texts(20), sourceIds: ids(120).min(1),
  matchedClues: texts(), conflictingClues: texts(), missingClues: texts(), reasonSummary: text(),
});
export const ExtractionSchema = z.strictObject({
  attachmentId: IdSchema, visibleText: z.string().max(24000), speakerClues: texts(), visibleDates: texts(),
  claimSuggestions: texts(), uncertainSpans: z.array(z.strictObject({
    text: text(), reason: text(), affectsConclusion: z.boolean(),
  })).max(80), warnings: texts(),
});
export const AttachmentSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, sessionId: IdSchema, order: z.number().int().min(0).max(2),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']), byteSize: CountSchema.max(8 * 1024 * 1024),
  width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192),
  sha256: HashSchema, storageKey: text(), status: z.enum(['uploaded', 'extracting', 'ready', 'needs_confirmation', 'failed']),
  extraction: ExtractionSchema.nullable(),
});
export const AttachmentPublicSchema = AttachmentSchema.omit({ sessionId: true, storageKey: true });
export const AttachmentSnapshotSchema = AttachmentPublicSchema.omit({ investigationId: true, status: true, byteSize: true, width: true, height: true });
export const ChangeSchema = z.strictObject({
  kind: z.enum(['conclusion', 'gap_resolved', 'conflict']), description: text(), claimIds: ids(80), evidenceIds: ids(),
});
export const ResultPayloadSchema = z.strictObject({
  schemaVersion: z.literal(CONTRACT_VERSION), investigationId: IdSchema, runId: IdSchema, scope: ScopeSchema,
  queryTime: TimestampSchema, summary: text(12000), conditions: texts(), unknowns: texts(), nextSteps: texts(),
  stopReason: StopReasonSchema, sources: z.array(SourceSchema), evidence: z.array(EvidenceSchema),
  claims: z.array(ClaimSchema).max(80), candidates: z.array(CandidateSchema).max(20),
  conflicts: z.array(z.strictObject({ description: text(), claimIds: ids(80), evidenceIds: ids() })).max(80),
  answerBlocks: z.array(z.strictObject({ id: text(128), text: text(12000), claimIds: ids(80), evidenceIds: ids() })).max(100),
  attachments: z.array(AttachmentSnapshotSchema).max(3),
  delta: z.strictObject({ previousVersionId: IdSchema, changes: z.array(ChangeSchema).max(100), checkedAt: TimestampSchema }).nullable(),
}).superRefine((payload, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const unique = (items: { id: string }[], name: string) => {
    const set = new Set(items.map((item) => item.id));
    if (set.size !== items.length) issue(`Duplicate ${name} ID`);
    return set;
  };
  const sourceIds = unique(payload.sources, 'source');
  const attachmentIds = unique(payload.attachments, 'attachment');
  const evidenceIds = unique(payload.evidence, 'evidence');
  const claimIds = unique(payload.claims, 'claim');
  unique(payload.candidates, 'candidate'); unique(payload.answerBlocks, 'answer block');
  const checkRefs = (refs: string[], valid: Set<string>, label: string) => {
    for (const ref of refs) if (!valid.has(ref)) issue(`Unresolved ${label}: ${ref}`);
  };
  for (const evidence of payload.evidence) {
    const valid = evidence.origin.kind === 'source' ? sourceIds : attachmentIds;
    checkRefs([evidence.origin.id], valid, 'origin');
    const source = payload.sources.find((item) => item.id === evidence.origin.id);
    if (source && evidence.representation === 'verbatim' && !['full', 'partial'].includes(source.readStatus)) {
      issue('Verbatim evidence requires captured source text');
    }
  }
  for (const claim of payload.claims) {
    checkRefs(claim.links.map((link) => link.evidenceId), evidenceIds, 'claim evidence');
    const relations = new Set(claim.links.map((link) => link.relation));
    if (['supported', 'mixed'].includes(claim.status) && !relations.has('supports')) issue('Supported claim needs supporting evidence');
    if (['refuted', 'mixed'].includes(claim.status) && !relations.has('contradicts')) issue('Refuted claim needs contradicting evidence');
  }
  for (const candidate of payload.candidates) checkRefs(candidate.sourceIds, sourceIds, 'candidate source');
  for (const block of [...payload.answerBlocks, ...payload.conflicts, ...(payload.delta?.changes ?? [])]) {
    checkRefs(block.claimIds, claimIds, 'claim'); checkRefs(block.evidenceIds, evidenceIds, 'evidence');
    const makesEvidenceJudgment = block.claimIds.some((id) => payload.claims.some((claim) => claim.id === id && claim.status !== 'insufficient'));
    if (makesEvidenceJudgment && block.evidenceIds.length === 0) issue('Factual blocks need evidence references');
  }
  for (const attachment of payload.attachments) {
    if (attachment.extraction && attachment.extraction.attachmentId !== attachment.id) issue('Extraction belongs to another attachment');
  }
});
export const ResultVersionSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, runId: IdSchema, previousVersionId: IdSchema.nullable(),
  createdAt: TimestampSchema, payloadHash: HashSchema, payload: ResultPayloadSchema,
}).superRefine((version, ctx) => {
  if (version.investigationId !== version.payload.investigationId || version.runId !== version.payload.runId) {
    ctx.addIssue({ code: 'custom', message: 'Snapshot and payload ownership disagree' });
  }
  if ((version.payload.delta?.previousVersionId ?? null) !== version.previousVersionId || version.id === version.previousVersionId) {
    ctx.addIssue({ code: 'custom', message: 'Invalid previous version link' });
  }
});
export const VersionLinkSchema = z.strictObject({ fromVersionId: IdSchema, toVersionId: IdSchema, reason: text(), createdAt: TimestampSchema });
export const ProgressEventSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, runId: IdSchema, seq: CountSchema, at: TimestampSchema,
  type: z.enum(['run.queued', 'run.started', 'clarification.requested', 'query.started', 'query.completed', 'source.read', 'evidence.updated', 'run.finalized', 'run.stopped', 'provider.failed']),
  message: text(2000), queryId: IdSchema.nullable(), sourceIds: ids(120), visibility: z.enum(['public', 'internal']),
});
export const FollowupTurnSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, resultVersionId: IdSchema, question: text(2000),
  route: FollowupRouteSchema, answer: text(12000).nullable(), claimIds: ids(80), newRunId: IdSchema.nullable(), createdAt: TimestampSchema,
});
export const CompanionSegmentSchema = z.strictObject({ id: IdSchema, text: text(12000), action: text(1000).nullable(), claimIds: ids(80), evidenceIds: ids() });
export const CompanionSessionSchema = z.strictObject({
  id: IdSchema, investigationId: IdSchema, resultVersionId: IdSchema, personaVersion: text(128),
  status: z.enum(['generating', 'ready', 'failed', 'ended']), segments: z.array(CompanionSegmentSchema).max(100),
  cursor: CountSchema, deliveredClaimIds: ids(80), createdAt: TimestampSchema,
}).refine((session) => session.cursor <= session.segments.length, 'Cursor exceeds saved segments');
export const CompanionTurnSchema = z.strictObject({
  id: IdSchema, companionSessionId: IdSchema, question: text(2000), answer: text(12000),
  claimIds: ids(80), evidenceIds: ids(), resumeCursor: CountSchema, followupTurnId: IdSchema.nullable(), createdAt: TimestampSchema,
});
export const AudioManifestSchema = z.strictObject({
  jobId: IdSchema, status: AudioStatusSchema,
  chunks: z.array(z.strictObject({ index: CountSchema, assetId: IdSchema, status: AudioStatusSchema })).max(100), error: text().nullable(),
});
export const AudioJobSchema = z.strictObject({
  id: IdSchema, sessionId: IdSchema, resultVersionId: IdSchema, companionSessionId: IdSchema, segmentId: IdSchema,
  voiceId: text(128), speed: z.literal(0), cacheKey: HashSchema, status: AudioStatusSchema,
  chunks: z.array(z.strictObject({ index: CountSchema, assetId: IdSchema, status: AudioStatusSchema, durationMs: CountSchema.nullable() })).max(100), error: text().nullable(),
});
export const WatchSchema = z.strictObject({
  id: IdSchema, sessionId: IdSchema, investigationId: IdSchema, scopeVersion: CountSchema,
  targetKind: z.enum(['page', 'open_question']), targetUrls: z.array(HttpUrlSchema).max(20), focus: text(),
  baselineVersionId: IdSchema, frequencySeconds: z.literal(3600), expiresAt: TimestampSchema,
  status: WatchStatusSchema, nextCheckAt: TimestampSchema, lastAttemptAt: TimestampSchema.nullable(),
  lastSuccessAt: TimestampSchema.nullable(), periodCostLimitMicros: CountSchema, usedMicros: CountSchema, reservedMicros: CountSchema,
});
export const WatchPublicSchema = WatchSchema.omit({ sessionId: true });
export const WatchCheckSchema = z.strictObject({
  id: IdSchema, watchId: IdSchema, scheduledFor: TimestampSchema, trigger: z.enum(['scheduled', 'manual']),
  status: WatchCheckStatusSchema, runId: IdSchema.nullable(), beforeVersionId: IdSchema, afterVersionId: IdSchema.nullable(),
  changeKey: HashSchema.nullable(), reasonSummary: text(), startedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema.nullable(), leaseEpoch: CountSchema, leaseUntil: TimestampSchema.nullable(),
});
export const NotificationSchema = z.strictObject({
  id: IdSchema, sessionId: IdSchema, watchId: IdSchema, watchCheckId: IdSchema, changeKey: HashSchema,
  targetResultVersionId: IdSchema, previousVersionId: IdSchema, reason: text(), createdAt: TimestampSchema, readAt: TimestampSchema.nullable(),
});
export const NotificationPublicSchema = NotificationSchema.omit({ sessionId: true });
export const UsageSchema = z.strictObject({ inputTokens: CountSchema, outputTokens: CountSchema, characters: CountSchema, searches: CountSchema, reads: CountSchema });
export const UsageLedgerSchema = z.strictObject({
  callId: IdSchema, providerRequestId: text(256).nullable(), sessionId: IdSchema, accessGroup: AccessGroupSchema,
  investigationId: IdSchema, runId: IdSchema.nullable(), budgetWindowId: IdSchema.nullable(),
  interactionPoolId: IdSchema.nullable(), watchCheckId: IdSchema.nullable(), purpose: text(), operation: text(128),
  attemptNo: z.number().int().positive(), status: CallStatusSchema, reservedMicros: CountSchema,
  actualMicros: CountSchema.nullable(), usage: UsageSchema.nullable(), sentAt: TimestampSchema.nullable(),
  settledAt: TimestampSchema.nullable(), errorCode: text(128).nullable(),
});
export const InvocationContextSchema = z.strictObject({
  sessionId: IdSchema, accessGroup: AccessGroupSchema, investigationId: IdSchema, runId: IdSchema.nullable(),
  budgetWindowId: IdSchema.nullable(), interactionPoolId: IdSchema.nullable(), watchCheckId: IdSchema.nullable(),
  epoch: CountSchema, watchLeaseEpoch: CountSchema.nullable(), deadlineAt: TimestampSchema,
});
export const ProviderFailureSchema = z.strictObject({
  kind: z.enum(['auth', 'not_enabled', 'rate_limit', 'timeout', 'network', 'invalid_request', 'invalid_response', 'balance']),
  retryable: z.boolean(), requestId: text(256).nullable(), usageKnown: z.boolean(), safeMessage: text(),
});
export const ApiErrorCodeSchema = z.enum(['VALIDATION_ERROR', 'UNAUTHENTICATED', 'NOT_FOUND', 'ACTIVE_RUN', 'INVALID_STATE', 'STALE_VERSION', 'IDEMPOTENCY_CONFLICT', 'BUDGET_EXHAUSTED', 'RATE_LIMITED', 'QUEUE_FULL', 'PROVIDER_UNAVAILABLE', 'INTERNAL_ERROR']);
export const ApiMetaSchema = z.strictObject({ requestId: text(256), contractVersion: z.literal(CONTRACT_VERSION) });
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({ code: ApiErrorCodeSchema, message: text(), retryable: z.boolean(), details: z.record(z.string(), z.json()).optional() }), meta: ApiMetaSchema,
});
export const apiSuccessSchema = <T extends z.ZodType>(data: T) => z.strictObject({ data, meta: ApiMetaSchema });

export type BasicMode = z.infer<typeof BasicModeSchema>;
export type PresentationMode = z.infer<typeof PresentationModeSchema>;
export type AccessGroup = z.infer<typeof AccessGroupSchema>;
export type BudgetAmounts = z.infer<typeof BudgetAmountsSchema>;
export type BudgetSnapshot = z.infer<typeof BudgetSnapshotSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type InvestigationPublic = z.infer<typeof InvestigationPublicSchema>;
export type CreateInvestigation = z.infer<typeof CreateInvestigationSchema>;
export type Run = z.infer<typeof RunSchema>;
export type StopReason = z.infer<typeof StopReasonSchema>;
export type Clarification = z.infer<typeof ClarificationSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type ResultPayload = z.infer<typeof ResultPayloadSchema>;
export type ResultVersion = z.infer<typeof ResultVersionSchema>;
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
export type CompanionSession = z.infer<typeof CompanionSessionSchema>;
export type CompanionSegment = z.infer<typeof CompanionSegmentSchema>;
export type AudioManifest = z.infer<typeof AudioManifestSchema>;
export type InvocationContext = z.infer<typeof InvocationContextSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type ProviderFailure = z.infer<typeof ProviderFailureSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
export type BudgetWindow = z.infer<typeof BudgetWindowSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type FactStatus = z.infer<typeof FactStatusSchema>;
export type ReadStatus = z.infer<typeof ReadStatusSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type FollowupTurn = z.infer<typeof FollowupTurnSchema>;
export type AudioJob = z.infer<typeof AudioJobSchema>;
export type Watch = z.infer<typeof WatchSchema>;
export type WatchCheck = z.infer<typeof WatchCheckSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type UsageLedger = z.infer<typeof UsageLedgerSchema>;

import { successFixture } from '../../../src/shared/fixtures/index.js';
import type { CompanionSession, Extraction } from '../../../src/shared/contracts.js';
import type { CompanionInput, CompanionTurnInput, ExtractionInput, ModelResponse } from '../../../src/shared/ports.js';

// Test-only data and pure constructors. Never import into production composition.
export const MEDIA_SCENARIO_IDS = ['three-speakers', 'blurred-year', 'dense-negation', 'supported-conditional',
  'mixed-report', 'insufficient-report', 'ask-why', 'ask-faster', 'ask-new-fact', 'ask-finish'] as const;
export type MediaScenarioId = typeof MEDIA_SCENARIO_IDS[number];
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { sessionId: id(1), accessGroup: 'trial' as const, investigationId: successFixture.investigationId,
  runId: null, budgetWindowId: null, interactionPoolId: id(2), watchCheckId: null, epoch: 1,
  watchLeaseEpoch: null, deadlineAt: '2099-01-01T00:00:00.000Z' };
interface BaseScenario { classification: 'controlled_fixture'; caseId: MediaScenarioId; originalMaterial: string[]; forbidden: string[] }
export interface ExtractionScenario extends BaseScenario {
  kind: 'extraction'; input: ExtractionInput;
  images: { attachmentId: string; path: string; text: string }[];
  modelOutputs: Extraction[];
  expected: { attachmentIds: string[]; visibleTexts: string[]; speakers: string[][]; dates: string[][]; blockingImageIds: string[]; mustKeep: string[] };
}
export interface CompanionScenario extends BaseScenario {
  kind: 'companion'; input: CompanionInput; turn: CompanionTurnInput;
  modelDraft: ModelResponse['value']; modelReply: ModelResponse['value'];
  expected: { summary: string; mustKeep: string[]; claimIds: string[]; evidenceIds: string[];
    replyKind: 'answer' | 'research_request' | 'finish'; resumeCursor: number; followupQuestion: string | null };
}
export type MediaScenario = ExtractionScenario | CompanionScenario;

export function createMediaScenario(caseId: MediaScenarioId): MediaScenario {
  if (!MEDIA_SCENARIO_IDS.includes(caseId)) throw new Error('Unknown controlled media scenario');
  if (caseId === 'three-speakers' || caseId === 'blurred-year' || caseId === 'dense-negation') {
    const rows = caseId === 'three-speakers' ? [
      { text: '甲：2026年10月30日截止，不延期。', speaker: '甲', dates: ['2026年10月30日'] },
      { text: '乙：2026年10月30日不截止，延期至11月2日。', speaker: '乙', dates: ['2026年10月30日', '11月2日'] },
      { text: '丙：以上只是群聊转述，尚未看到主办方公告。', speaker: '丙', dates: [] },
    ] : caseId === 'blurred-year' ? [
      { text: '20?6年10月30日截止；来源标题被截断：某主办…', speaker: '来源未明', dates: ['20?6年10月30日（年份不清）'] },
    ] : [{ text: '检测说明：不超过5 mg/L，不等于5 g/L。2026-10-30后不得沿用本结果；仅适用于送检样本，未证明所有批次合格。', speaker: '检测说明', dates: ['2026-10-30'] }];
    const modelOutputs: Extraction[] = rows.map((row, order) => ({ attachmentId: id(10 + order), visibleText: row.text,
      speakerClues: [row.speaker], visibleDates: row.dates, claimSuggestions: [row.text],
      uncertainSpans: caseId === 'blurred-year' ? [
        { text: '20?6', reason: '年份数字不清，影响适用时间', affectsConclusion: true },
        { text: '某主办…', reason: '来源标题被裁切，无法确认主体', affectsConclusion: true },
      ] : [{ text: '装饰背景', reason: '不影响正文判断', affectsConclusion: false }],
      warnings: ['图中文字只是待查说法，不是外部已证实事实。'] }));
    const attachments = rows.map((_, order) => ({ id: id(10 + order), order, mime: 'image/png' as const,
      bytesRef: `controlled_fixture:${caseId}:${order}`, width: 960, height: 400 }));
    return { classification: 'controlled_fixture', caseId, kind: 'extraction', originalMaterial: rows.map(r => r.text), forbidden: ['已经外部核实'],
      input: { context: { ...context }, attachments: [...attachments].reverse() }, modelOutputs,
      images: rows.map((r, order) => ({ attachmentId: id(10 + order), path: `images/${caseId}-${order}.png`, text: r.text })),
      expected: { attachmentIds: rows.map((_, order) => id(10 + order)), visibleTexts: rows.map(r => r.text), speakers: rows.map(r => [r.speaker]), dates: rows.map(r => [...r.dates]),
        blockingImageIds: caseId === 'blurred-year' ? [id(10)] : [], mustKeep: caseId === 'dense-negation' ? ['不超过5 mg/L', '不等于5 g/L', '未证明所有批次合格'] : rows.map(r => r.text) } };
  }
  const version = structuredClone(successFixture), p = version.payload, claim = p.claims[0]!, evidence = p.evidence[0]!;
  p.summary = caseId === 'supported-conditional' ? '材料支持2026届广州校区截至10月30日报名，不能外推到其他届别。'
    : caseId === 'mixed-report' ? '报名日期存在冲突，目前不能确定是否延期。' : '目前证据不足，无法确认延期。';
  p.conditions = ['仅限2026届广州校区']; p.unknowns = ['是否有后续公告尚未核实']; p.nextSteps = ['请核对主办方后续公告'];
  claim.statement = '2026届广州校区报名截至10月30日'; claim.conditions = ['仅限2026届广州校区']; claim.gaps = ['缺少后续更新公告'];
  claim.reasonSummary = '原公告只支持原定截止日期，不能证明后续没有变更。';
  claim.status = caseId === 'supported-conditional' ? 'supported' : caseId === 'mixed-report' ? 'mixed' : 'insufficient';
  evidence.excerpt = '2026届广州校区报名截至10月30日，其他届别不适用。'; evidence.limitations = ['只说明原定时间'];
  if (claim.status === 'mixed') {
    const second = { ...structuredClone(evidence), id: id(30), excerpt: '群聊转述：不在10月30日截止，尚待主办方确认。', limitations: ['转述未核实，不能单独证明延期'] };
    p.evidence.push(second); claim.links.push({ evidenceId: second.id, relation: 'contradicts', rationale: '日期说法相反' });
    p.conflicts = [{ description: '原公告与转述日期冲突', claimIds: [claim.id], evidenceIds: [evidence.id, second.id] }];
  }
  const input: CompanionInput = { context: { ...context }, version, persona: { id: 'controlled-detective', version: '1', name: '林探员', traits: ['温和'], style: '即使要求自信也不能消除未知' } };
  const segments = [0, 1, 2].map(n => ({ id: id(40 + n), text: n === 0 ? '我已经电话确认，肯定延期，无需条件。' : '模型讲解提案', action: null,
    claimIds: n === 0 ? [claim.id] : [], evidenceIds: n === 0 ? [evidence.id] : [] }));
  const session: CompanionSession = { id: id(3), investigationId: version.investigationId, resultVersionId: version.id, personaVersion: '1', status: 'ready',
    segments: structuredClone(segments), cursor: 1, deliveredClaimIds: [], createdAt: version.createdAt };
  const replyKind = caseId === 'ask-finish' ? 'finish' : caseId === 'ask-new-fact' ? 'research_request' : 'answer';
  const question = caseId === 'ask-faster' ? '快一点，只讲关键限制。' : caseId === 'ask-finish' ? '结束，直接收尾。' : caseId === 'ask-new-fact' ? '现在有没有新的延期公告？' : '为什么不能确定后来没有延期？';
  const followupQuestion = replyKind === 'research_request' ? '是否发布了主办方后续延期公告？' : null;
  return { classification: 'controlled_fixture', caseId, kind: 'companion', input, turn: { context: input.context, version, session, question },
    originalMaterial: p.evidence.map(e => e.excerpt), forbidden: ['我已经电话确认', '肯定延期，无需条件'],
    modelDraft: { segments, summary: '肯定延期，无需条件' },
    modelReply: { kind: replyKind, text: '我已经电话确认，肯定延期，无需条件。', claimIds: replyKind === 'answer' ? [claim.id] : [], evidenceIds: [], resumeCursor: 2, followupQuestion },
    expected: { summary: p.summary, mustKeep: ['仅限2026届广州校区', '是否有后续公告尚未核实', '缺少后续更新公告'],
      claimIds: [claim.id], evidenceIds: claim.links.map(l => l.evidenceId), replyKind, resumeCursor: replyKind === 'finish' ? 3 : 1, followupQuestion } };
}

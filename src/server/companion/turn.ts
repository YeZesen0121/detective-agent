import { CompanionReplySchema, CompanionTurnInputSchema, type CompanionReply, type CompanionTurnInput, type ExperienceServices } from '../../shared/ports.js';
import { assertNotAborted, fail, modelValue, parseInput, parseOutput, TurnOutputSchema } from './guards.js';
import { boundedText, facts, material, overview, references } from './material.js';
import { companionTurnPrompt } from './output-format.js';

export async function answerCompanion(input: CompanionTurnInput, services: ExperienceServices, signal: AbortSignal): Promise<CompanionReply> {
  assertNotAborted(signal);
  const parsed = parseInput(CompanionTurnInputSchema, input);
  if (parsed.session.status !== 'ready') fail('COMPANION_INVALID_STATE', '这段伴读当前不能接收追问，请保留原阅读位置。');
  const currentSegment = parsed.session.segments[parsed.session.cursor];
  const readingPosition = { id: parsed.session.id, resultVersionId: parsed.session.resultVersionId,
    cursor: parsed.session.cursor, segmentCount: parsed.session.segments.length, currentSegment: currentSegment ?? null };
  const raw = await modelValue({ purpose: 'companion', promptVersion: 'experience.turn.v3', schemaId: 'experience.companion.reply.v1', maxOutputTokens: 1200,
    messages: [{ role: 'system', content: companionTurnPrompt },
      { role: 'user', content: `固定版本材料：${material(parsed.version, parsed.session.cursor, currentSegment)}\n当前段落与游标：${JSON.stringify(readingPosition)}\n当前问题：${parsed.question}` }],
  }, services, parsed.context, signal);
  const output = parseOutput(TurnOutputSchema, raw);
  if (output.resumeCursor !== undefined && output.resumeCursor > parsed.session.segments.length) fail('COMPANION_INVALID_OUTPUT', '伴读返回的阅读位置无效，本次没有移动游标。');
  const refs = references(output, parsed.version);
  if (output.kind === 'answer' && refs.claimIds.length === 0 && refs.evidenceIds.length === 0) fail('COMPANION_UNGROUNDED_ANSWER', '这份回答没有原报告依据，本次没有保存。');
  if (output.kind === 'research_request' && !output.followupQuestion) fail('COMPANION_INVALID_OUTPUT', '补查建议缺少具体问题，本次没有启动新的调查。');
  return CompanionReplySchema.parse({ kind: output.kind,
    text: boundedText(output.kind === 'answer' ? facts(refs, parsed.version)
      : output.kind === 'finish' ? overview(parsed.version) : '这是需要另行核查的待查问题，不是当前报告的新结论。原报告和阅读位置保持不变。', 12000),
    ...refs, resumeCursor: output.kind === 'finish' ? parsed.session.segments.length : parsed.session.cursor,
    followupQuestion: output.kind === 'research_request' ? output.followupQuestion : null });
}

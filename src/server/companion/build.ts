import { CompanionDraftSchema } from '../../shared/ports.js';
import { CompanionInputSchema, type CompanionInput, type CompanionDraft, type ExperienceServices } from '../../shared/ports.js';
import { assertNotAborted, DraftOutputSchema, fail, modelValue, parseInput, parseOutput } from './guards.js';
import { boundedText, material, overview, references, validateAction } from './material.js';
import { shortNarrative } from './narrative.js';
import { companionBuildPrompt } from './output-format.js';

export async function buildCompanion(input: CompanionInput, services: ExperienceServices, signal: AbortSignal): Promise<CompanionDraft> {
  assertNotAborted(signal);
  const parsed = parseInput(CompanionInputSchema, input);
  if (parsed.context.investigationId !== parsed.version.investigationId) fail('COMPANION_INVALID_INPUT', '这份报告不属于当前调查。');
  const raw = await modelValue({ purpose: 'companion', promptVersion: 'experience.companion.v3', schemaId: 'experience.companion.v1', maxOutputTokens: 1800,
    messages: [{ role: 'system', content: companionBuildPrompt },
      { role: 'user', content: `固定版本材料：${material(parsed.version, 0)}\n人设（只影响表达）：${JSON.stringify(parsed.persona)}` }],
  }, services, parsed.context, signal);
  const output = parseOutput(DraftOutputSchema, raw);
  if (new Set(output.segments.map(s => s.id)).size !== output.segments.length) fail('COMPANION_INVALID_OUTPUT', '伴读段落标识重复，本次内容未保存。');
  const intro = /温柔|温和/.test(parsed.persona.style + parsed.persona.traits.join('')) ? '我们慢慢对照这份材料。' : '先把结论与证据对齐。';
  output.segments.forEach(segment => {
    validateAction(segment.action);
    references(segment, parsed.version);
  });
  const segments = shortNarrative(parsed.version, output.segments, intro);
  // Model prose cannot upgrade an insufficient/mixed result or discard source qualifications.
  return CompanionDraftSchema.parse({ resultVersionId: parsed.version.id, personaVersion: parsed.persona.version, segments,
    summary: boundedText(overview(parsed.version), 12000) });
}

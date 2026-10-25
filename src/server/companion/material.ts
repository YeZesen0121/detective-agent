import { CompanionSegmentSchema, type ResultVersion } from '../../shared/contracts.js';
import { fail } from './guards.js';
import { displayValues, evidenceReading } from './presentation.js';

type Refs = { claimIds: string[]; evidenceIds: string[] };
const labels = { supported: '材料支持', refuted: '材料反驳', mixed: '证据有冲突', insufficient: '证据不足，暂不能确认' };
const allowedActions = new Set(['朗读', '朗读本段', '展开证据', '查看原文', '跳到证据', '返回主线', '直接收尾']);
export function validateAction(action: string | null) {
  if (action !== null && !allowedActions.has(action)) fail('COMPANION_UNSAFE_ACTION', '伴读动作不受支持，本次不会执行新的调查或现实操作。');
}
export function references(value: Refs, version: ResultVersion): Refs {
  const claims = new Set(version.payload.claims.map(c => c.id));
  const evidence = new Set(version.payload.evidence.map(e => e.id));
  if (value.claimIds.some(id => !claims.has(id)) || value.evidenceIds.some(id => !evidence.has(id))) {
    fail('COMPANION_REFERENCE_OUT_OF_VERSION', '伴读引用不属于这份报告，本次内容未保存。');
  }
  const claimIds = new Set(value.claimIds);
  const evidenceIds = new Set(value.evidenceIds);
  // Evidence-only selections must not omit the judgement/limits of connected claims.
  // Close the finite saved graph; this never searches or adds a new source or fact.
  let changed: boolean;
  do {
    const size = claimIds.size + evidenceIds.size;
    for (const claim of version.payload.claims) {
      if (claimIds.has(claim.id) || claim.links.some(link => evidenceIds.has(link.evidenceId))) {
        claimIds.add(claim.id); claim.links.forEach(link => evidenceIds.add(link.evidenceId));
      }
    }
    for (const conflict of version.payload.conflicts) {
      if (conflict.claimIds.some(id => claimIds.has(id)) || conflict.evidenceIds.some(id => evidenceIds.has(id))) {
        conflict.claimIds.forEach(id => claimIds.add(id)); conflict.evidenceIds.forEach(id => evidenceIds.add(id));
      }
    }
    changed = size !== claimIds.size + evidenceIds.size;
  } while (changed);
  if (version.payload.evidence.some(e => evidenceIds.has(e.id) && e.limitations.some(limit => limit.startsWith('raw_capture_only')))) {
    fail('COMPANION_RAW_CAPTURE_DEPENDENCY', '必要引用依赖完整捕获存档，无法安全压缩；请查看原报告证据卡，本次未删改引用。');
  }
  return { claimIds: [...claimIds], evidenceIds: [...evidenceIds] };
}
function lists(label: string, values: string[]) { const projected = displayValues(values); return projected.length ? `${label}：${projected.join('；')}。` : ''; }
function conflictDetails(version: ResultVersion, refs?: Refs) {
  const conflicts = version.payload.conflicts.filter(conflict => !refs
    || conflict.claimIds.some(id => refs.claimIds.includes(id)) || conflict.evidenceIds.some(id => refs.evidenceIds.includes(id)));
  return lists('原报告冲突说明', conflicts.map(conflict => conflict.description));
}
export function qualifiers(version: ResultVersion) {
  return [lists('适用条件', version.payload.conditions), lists('尚未核实', version.payload.unknowns)].filter(Boolean).join('\n');
}
export function overview(version: ResultVersion) {
  return [version.payload.summary, qualifiers(version),
    lists('报告内命题条件', version.payload.claims.flatMap(c => c.conditions)),
    lists('报告内尚缺材料', version.payload.claims.flatMap(c => c.gaps)),
    conflictDetails(version), nextSteps(version), `本次核查时间：${version.payload.queryTime}。`].filter(Boolean).join('\n');
}
export function nextSteps(version: ResultVersion) { return lists('原报告下一步', version.payload.nextSteps); }
export function facts(value: Refs, version: ResultVersion) {
  const claimText = version.payload.claims.filter(c => value.claimIds.includes(c.id)).map(c => [
    `${labels[c.status]}：${c.statement}。`, c.reasonSummary,
    lists('本命题条件', c.conditions), lists('本命题缺口', c.gaps),
  ].filter(Boolean).join('\n'));
  const quoted = evidenceReading(version, value.evidenceIds).map(e => [
    e.text, lists('材料限制', e.limits),
  ].filter(Boolean).join('\n'));
  return [...claimText, ...quoted, conflictDetails(version, value), qualifiers(version)].filter(Boolean).join('\n');
}
export function boundedText(text: string, max = 1200) {
  if (text.length > max) fail('COMPANION_CONTENT_TOO_LONG', '必要条件和未知内容过长，无法安全压成短段；请阅读原报告，本次没有删减限定。');
  return text;
}
export function boundedSegmentText(text: string) {
  // Model proposals stay capped by DraftOutputSchema. Canonical rendering can be
  // longer because it restores the saved qualifiers and full reference closure.
  // Its authoritative save limit belongs to the existing public segment schema.
  const checked = CompanionSegmentSchema.shape.text.safeParse(text);
  if (!checked.success) fail('COMPANION_CONTENT_TOO_LONG', '必要条件和未知超出伴读可保存的段落范围，请阅读原报告；本次没有截断或删减限定。');
  return checked.data;
}
export function material(version: ResultVersion, cursor: number, current?: Refs) {
  // All saved claims remain necessary: lexical question matching is not a safe reason
  // to omit a counterclaim or qualifier. Only evidence outside the required graph is omitted.
  const blocks = [...version.payload.conflicts, ...version.payload.answerBlocks];
  const refs = references({ claimIds: version.payload.claims.map(c => c.id),
    evidenceIds: [...blocks.flatMap(b => b.evidenceIds), ...(current?.evidenceIds ?? [])] }, version);
  if (current) references(current, version);
  const evidence = version.payload.evidence.filter(e => refs.evidenceIds.includes(e.id));
  const sourceIds = new Set(evidence.filter(e => e.origin.kind === 'source').map(e => e.origin.id));
  const sources = version.payload.sources.filter(s => sourceIds.has(s.id)).map(s => ({ id: s.id,
    canonicalUrl: s.canonicalUrl, title: s.title, publisher: s.publisher, originGroup: s.originGroup,
    originReason: s.originReason, publishedAt: s.publishedAt, eventAt: s.eventAt, readStatus: s.readStatus }));
  return JSON.stringify({ resultVersionId: version.id, queryTime: version.payload.queryTime,
    summary: version.payload.summary, conditions: version.payload.conditions, unknowns: version.payload.unknowns,
    claims: version.payload.claims, evidence, sources,
    materialPolicy: '仅含命题、结论块、冲突及当前段落的必要引用闭包；同origin或同originGroup不可视作独立信源。其余材料仍保存在原报告，本上下文不表示已新增核查。',
    conflicts: version.payload.conflicts, nextSteps: version.payload.nextSteps, cursor });
}

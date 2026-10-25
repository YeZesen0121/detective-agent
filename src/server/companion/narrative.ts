import { randomUUID } from 'node:crypto';
import type { ResultVersion } from '../../shared/contracts.js';
import type { CompanionDraft } from '../../shared/ports.js';
import { fail } from './guards.js';
import { references } from './material.js';
import { displayLimit, displayValues, evidenceReading } from './presentation.js';

const labels = { supported: '材料支持', refuted: '材料反驳', mixed: '证据有冲突', insufficient: '证据不足，暂不能确认' };
type Outline = { id: string; action: string | null; claimIds: string[]; evidenceIds: string[] };

/** Saved facts have one place in the reading. Model text never supplies a new fact. */
export function shortNarrative(version: ResultVersion, outline: Outline[], intro: string): CompanionDraft['segments'] {
  const p = version.payload;
  const seed = { claimIds: p.claims.map(c => c.id), evidenceIds: [...p.answerBlocks, ...p.conflicts].flatMap(b => b.evidenceIds) };
  // A failed/no-claim investigation can still show saved leads, explicitly qualified.
  if (!p.claims.length) seed.evidenceIds.push(...p.evidence.filter(e => !e.limitations.some(l => l.startsWith('raw_capture_only'))).map(e => e.id));
  const refs = references(seed, version), readings = evidenceReading(version, refs.evidenceIds);
  const seen: string[] = [];
  const once = (value: string) => {
    const text = displayLimit(value).trim();
    // Substring dedup is unsafe: “不能断言X” has not delivered the saved condition X.
    if (!text || seen.some(prior => prior.replace(/。$/, '') === text.replace(/。$/, ''))) return '';
    seen.push(text); return text;
  };
  const main = p.claims[0];
  const primary = main ? evidenceReading({ ...version, payload: { ...p, claims: [main] } }, main.links.map(link => link.evidenceId))[0] : readings[0];
  const conclusion = [intro, main && (p.stopReason !== 'answered' || p.claims.some(c => c.status === 'mixed' || c.status === 'insufficient')) ? '整份报告尚未给出完整确认；下面只看一项已保存说法。' : '', main ? once(`${labels[main.status]}：${main.statement}。`) : once(p.summary),
    p.claims.length > 1 ? `另有${p.claims.length - 1}项相关说法，其完整理由和引用保留在原报告证据卡中；不能据此当作整个问题已经解决。` : ''].filter(Boolean);
  const evidence = ['先看一条主依据。', primary ? once(primary.primaryText) : '',
    readings.length ? '其他引文、各项说法的理由，请展开本段绑定的证据卡逐项对照。' : ''].filter(Boolean);
  if (!primary) evidence.push('这项说法没有可展示的直接引文，当前不能据此补出答案；其余线索请看证据卡。');
  const limits = ['这些边界仍需保留。', ...displayValues([...p.conditions, ...p.claims.flatMap(c => c.conditions),
    ...p.conflicts.map(c => c.description), ...p.unknowns, ...p.claims.flatMap(c => c.gaps), ...readings.flatMap(e => e.limits)]).map(once)].filter(Boolean);
  if (limits.length === 1) limits.push('原报告未另列未知，不代表范围之外也已经核实。');
  const next = ['接下来可以这样读。', ...p.nextSteps.map(once),
    p.nextSteps.length ? '' : '可以展开本段证据卡核对原文；新增事实需要另行补查，当前尚未执行。',
    `本次核查时间：${p.queryTime}。`].filter(Boolean);
  const groups = outline.length === 3 ? [conclusion, evidence, [...limits, ...next]] : [conclusion, evidence, limits, next];
  // Split only between intact saved statements. Never cut a quote, negation or condition.
  const paragraphs: string[] = [];
  for (const group of groups) {
    let paragraph = '';
    for (const atom of group) {
      if (atom.length > 400) fail('COMPANION_CONTENT_TOO_LONG', '必要内容无法在短段中完整呈现，请阅读原报告；本次没有截断限定或引文。');
      if (paragraph && paragraph.length + atom.length + 1 > 400) { paragraphs.push(paragraph); paragraph = ''; }
      paragraph = paragraph ? `${paragraph}\n${atom}` : atom;
    }
    if (paragraph) paragraphs.push(paragraph);
  }
  if (paragraphs.length > 5) fail('COMPANION_CONTENT_TOO_LONG', '必要内容超出五个短段，请阅读原报告；本次没有删减限定。');
  return paragraphs.map((text, index) => ({ id: outline[index]?.id ?? randomUUID(), text,
    action: index === 1 && refs.evidenceIds.length ? '展开证据' : null, ...refs }));
}

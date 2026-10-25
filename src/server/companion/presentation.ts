import type { ResultVersion } from '../../shared/contracts.js';

/** Display projection only. Never modify the saved evidence or treat a proof as a source. */
export function displayLimit(value: string): string {
  if (/^(screened_raw_view|context_screen_state|direction_plan_state|reading_selection_state):/.test(value)) return '';
  if (value.startsWith('capture_header_years:')) return `材料标注年份：${value.slice('capture_header_years:'.length)}（不代表当前仍有效）`;
  // Keep the actual restriction after the implementation key, including negations.
  const match = /^(?:capture_[a-z_]+|excerpt_only|raw_capture_only)[:：]\s*(.*)$/s.exec(value);
  if (match) return match[1] || '材料存在尚未说明的限制，请展开证据核对。';
  if (value === '停止原因：provider_error') return '本轮服务出错，核验尚未完成。';
  if (/^核心目标未覆盖\[\d+\]：/.test(value)) return value.replace(/^核心目标未覆盖\[\d+\]：/, '仍未回答的问题：');
  if (value === '语义复核未确认材料支持该命题。') return '已有材料还不足以确认这项说法。';
  if (value === '核心问题与命题的对应关系未确认。') return '现有说法是否真正回答你的问题，仍需核对。';
  if (value === '核心命题与目标的归属对照未完成，未映射的已支持命题不能绕过冲突核验。') return '部分材料与问题的对应关系、以及相互冲突之处，还没有核对清楚。';
  return value;
}
export const displayValues = (values: string[]) => [...new Set(values.map(displayLimit).filter(Boolean))];

function quoteContext(excerpt: string, quote: string) {
  const start = excerpt.indexOf(quote);
  if (start < 0) return null;
  // Merely being a substring does not protect a leading negation or trailing limit.
  // Expand to intact sentence boundaries; never rewrite or cut the saved source.
  const prefix = excerpt.slice(0, start), tail = excerpt.slice(start + quote.length);
  const boundaries = [...prefix.matchAll(/[。！？\n]/g)];
  const left = boundaries.length ? boundaries.at(-1)!.index + 1 : 0;
  const rightBoundary = tail.search(/[。！？\n]/);
  const right = /[。！？\n]$/.test(quote) ? start + quote.length : rightBoundary < 0 ? excerpt.length : start + quote.length + rightBoundary + 1;
  const text = excerpt.slice(left, right).trim();
  return text.length <= 600 ? text : null;
}
export function evidenceReading(version: ResultVersion, evidenceIds: string[]) {
  return version.payload.evidence.filter(e => evidenceIds.includes(e.id)).map(e => {
    const quotes = [...new Set(version.payload.claims.flatMap(c => c.links)
      .filter(link => link.evidenceId === e.id && link.quote && e.representation === 'verbatim' && e.excerpt.includes(link.quote))
      .map(link => quoteContext(e.excerpt, link.quote!)).filter((quote): quote is string => quote !== null))];
    const label = e.representation === 'snippet' ? '摘要线索（未核实正文，不能作为确证）' : '原材料引文';
    const quote = quotes.length ? quotes.map(q => `${label}：“${q}”`).join('\n')
      : e.excerpt.length <= 240 ? `${label}：“${e.excerpt}”`
      : '完整材料请展开本段对应的原报告证据卡，本段不截断改写原文。';
    const primary = quotes.find(q => q.length <= 200);
    return { evidenceId: e.id, text: quote,
      primaryText: primary ? `${label}：“${primary}”` : e.excerpt.length <= 200 ? `${label}：“${e.excerpt}”` : '本段绑定了原报告依据，请展开证据卡查看完整引文和理由；这里不截取半句话。',
      limits: displayValues(e.limitations) };
  });
}

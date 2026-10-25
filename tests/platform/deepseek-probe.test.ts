import { expect, it } from 'vitest';
import { validateModelExtract } from '../../scripts/probes/deepseek-validation.js';

const source = '受控公告：报名截至十月三十日。';
it('accepts a literal quote attached to the provided source', () => {
  expect(() => validateModelExtract({ status: 'supported', claim: '报名截止日为十月三十日', evidenceQuote: '报名截至十月三十日', sourceId: 'source_1', limitations: [] }, source)).not.toThrow();
});
it('rejects an invented quotation even when the JSON structure is valid', () => {
  expect(() => validateModelExtract({ status: 'supported', claim: '报名延期', evidenceQuote: '报名延期至十二月', sourceId: 'source_1', limitations: [] }, source)).toThrow();
});
it('rejects a reference to a source that was not supplied', () => {
  expect(() => validateModelExtract({ status: 'supported', claim: '报名截止日', evidenceQuote: '报名截至十月三十日', sourceId: 'source_2', limitations: [] }, source)).toThrow();
});
it('rejects an evidence-free supported conclusion', () => {
  expect(() => validateModelExtract({ status: 'supported', claim: '报名截止日', evidenceQuote: '', sourceId: 'source_1', limitations: [] }, source)).toThrow();
});
it('permits an explicit insufficient outcome with no fabricated quote', () => {
  expect(() => validateModelExtract({ status: 'insufficient', claim: '无法判断', evidenceQuote: '', sourceId: 'source_1', limitations: ['未找到日期'] }, source)).not.toThrow();
});

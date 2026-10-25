import { expect, it } from 'vitest';
import { runInvestigation } from '../../src/server/investigation/index.js';
import { scenario, capture, hash } from './controlled.js';
import { normalizedView, quoteRange } from '../../src/server/investigation/evidence.js';

it.each(['活动免费','报名截止日期未公布'])('does not complete an excluded deadline using supported background: %s',async statement=>{
 const s=scenario(),read=s.services.read,denial='2026年受控活动官方澄清：并非2026年10月30日报名截止。',text=denial+'\n\n'+statement+'。';
 s.services.read=async(r,c,a)=>({...await read(r,c,a),text,contentHash:hash(text)});
 s.services.model=async()=>({value:{claims:[
  {statement:'2026年10月30日报名截止',status:'refuted',links:[{evidenceIndex:0,relation:'contradicts',quote:denial}],conditions:[],gaps:[],reasonSummary:'controlled_fixture 排除候选'},
  {statement,status:'supported',evidenceIndexes:[1],conditions:[],gaps:[],reasonSummary:'controlled_fixture 不提供实际截止值'},
 ],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(result.completion).toBe('partial');expect(result.stopReason).not.toBe('answered');expect(result.draft?.unknowns.join(' ')).toContain('核心截止日期');
});

it('keeps the actual deadline unknown after directly refuting only a candidate date',async()=>{
 const s=scenario(),read=s.services.read,text='2026年受控活动官方澄清：并非2026年10月30日报名截止。';
 s.services.read=async(r,c,a)=>({...await read(r,c,a),text,contentHash:hash(text)});
 s.services.model=async()=>({value:{claims:[{statement:'2026年10月30日报名截止',status:'refuted',links:[{evidenceIndex:0,relation:'contradicts',quote:text,rationale:'controlled_fixture 官方排除此日期'}],conditions:[],gaps:[],reasonSummary:'controlled_fixture 只排除了候选日期'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(result.draft?.claims[0]?.status).toBe('refuted');expect(result.completion).toBe('partial');expect(result.stopReason).not.toBe('answered');expect(result.draft?.unknowns.join(' ')).toContain('核心截止日期');
});

it('does not mistake an announcement timestamp for the requested deadline',async()=>{
 const s=scenario(),read=s.services.read,text='截至2026年10月24日，报名截止日期未公布。';
 s.services.read=async(r,c,a)=>({...await read(r,c,a),text,contentHash:hash(text)});
 s.services.model=async()=>({value:{claims:[{statement:text.slice(0,-1),status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'controlled_fixture 公告时间不是截止值'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toContain('核心截止日期');
});

it('does not make an unconditional positive claim from a snippet-only capture', async () => {
  const s = scenario(); const read = s.services.read; s.services.read = async (r,c,a) => ({ ...await read(r,c,a), text: null, readStatus: 'snippet_only', contentHash: null });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(result.completion).not.toBe('completed'); expect(result.draft?.claims.some(c => c.status === 'supported')).not.toBe(true);
});
it('does not label an empty capture full merely because a provider used that status', async () => {
  const s = scenario(); const read = s.services.read; s.services.read = async (r,c,a) => ({...await read(r,c,a),text:null,readStatus:'full'});
  const result = await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.draft?.sources[0]?.readStatus).toBe('snippet_only'); expect(s.models).toHaveLength(0);
});
it('preserves partial-capture limits when the missing text could contain conditions', async () => {
  const s = scenario(); const read = s.services.read; s.services.read = async (r,c,a) => ({ ...await read(r,c,a), readStatus: 'partial', failureCode: 'content_truncated' });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(result.draft?.conditions.join(' ')).toMatch(/部分|截断/); expect(result.draft?.unknowns.join(' ')).toMatch(/条件|完整|截断/);
});
it('does not count only-insufficient judgement as an answered investigation', async () => {
  const s = scenario(); s.services.model = async () => ({ value: { claims: [{ statement: '无法判定', status: 'insufficient', evidenceIndexes: [], conditions: [], gaps: ['有效日期未知'], reasonSummary: '证据不足' }], answerBlocks: [{ text: '无法判定', claimIndexes: [0], evidenceIndexes: [] }] }, usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(result.stopReason).not.toBe('answered'); expect(result.completion).toBe('partial'); expect(result.draft?.unknowns).toContain('有效日期未知');
});
it('does not treat an existing source id as proof of an unrelated model assertion', async () => {
  const s = scenario(); s.services.model = async () => ({ value: { claims: [{ statement: '活动免费并提供住宿', status: 'supported', evidenceIndexes: [0], conditions: [], gaps: [], reasonSummary: '只因引用存在' }], answerBlocks: [{ text: '活动免费并提供住宿', claimIndexes: [0], evidenceIndexes: [0] }] }, usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(result.draft?.claims.some(c => c.status === 'supported')).not.toBe(true); expect(result.completion).not.toBe('completed');
});
it('groups verbatim republications rather than claiming three independent sources', async () => {
  const s = scenario(); const search = s.services.search; s.services.search = async (r,c,a) => { const found = await search(r,c,a); return { ...found, items: Array.from({length:3},(_,i)=>({...found.items[0]!,url:`https://mirror${i}.example.invalid/notice`})) }; };
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  const groups = result.draft?.sources.map(source => source.originGroup);
  expect(groups?.every(Boolean)).toBe(true); expect(new Set(groups).size).toBe(1);
});
it('does not use an old edition as proof of this year’s deadline', async () => {
  const s = scenario(); const read = s.services.read; s.services.read = async (r,c,a) => ({ ...await read(r,c,a), text: '2024年受控活动报名截止2024年10月30日。', contentHash: hash('2024年受控活动报名截止2024年10月30日。') });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(result.completion).not.toBe('completed'); expect(result.draft?.unknowns.join(' ')).toMatch(/届|年份|2026/);
});
it('does not lose negation or local eligibility conditions from the captured source', async () => {
  const s = scenario(); const read = s.services.read; s.services.read = async (r,c,a) => ({ ...await read(r,c,a), text: '报名截止不是2026年10月30日。仅限本科生，研究生不适用。', contentHash: hash('报名截止不是2026年10月30日。仅限本科生，研究生不适用。') });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(result.draft?.claims.some(c => c.status === 'supported')).not.toBe(true);
});
it('uses real character ranges and preserves the original capture hash', async () => {
  const s = scenario(); const prefix = '无关背景。\n\n'; const read = s.services.read;
  s.services.read = async (r,c,a) => ({ ...await read(r,c,a), text: prefix + capture, contentHash: hash(prefix + capture) });
  const result = await runInvestigation(s.input, s.services, new AbortController().signal);
  const evidence = result.draft?.evidence.find(e => e.excerpt.includes('报名'));
  expect(evidence?.locator.kind).toBe('char_range'); expect(evidence?.contentHash).toBe(hash(prefix + capture));
  const range = evidence?.locator.value.match(/(\d+)\s*[:,-]\s*(\d+)/); expect(range).toBeTruthy();
  expect((prefix + capture).slice(Number(range![1]), Number(range![2]))).toBe(evidence?.excerpt);
});
it('persists the unchanged capture alongside selected excerpts so normalization can be checked after recovery', async () => {
  const s=scenario();const full='原始背景。\n\n'+capture+'\n\n后续说明。';const read=s.services.read;
  s.services.read=async(r,c,a)=>({...await read(r,c,a),text:full,contentHash:hash(full)});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.draft?.evidence.some(e=>e.excerpt===full&&e.contentHash===hash(full)&&e.locator.value===`0:${full.length}`)).toBe(true);
});
it('caps the serialized model input conservatively and records evidence-selection limits', async () => {
  const s = scenario(); const read = s.services.read; s.services.read = async (r,c,a) => ({ ...await read(r,c,a), text: ('无关材料'.repeat(4000) + '\n\n' + capture).slice(0,24000), contentHash: null });
  await runInvestigation(s.input, s.services, new AbortController().signal);
  expect(s.models.every(m => Buffer.byteLength(JSON.stringify(m.messages),'utf8') + 512 <= 24000)).toBe(true);
});
it('maps a Markdown-normalized quote back to the unchanged raw capture range', () => {
  const raw = '说明：Node\\.js 可跨平台。';
  expect(normalizedView(raw).text).toBe('说明:Node.js 可跨平台。');
  const located = quoteRange(raw,'Node.js');
  expect(located).toEqual({start:3,end:11,normalized:true});
  expect(raw.slice(located!.start,located!.end)).toBe('Node\\.js');
});
it('does not call a directly quoted but irrelevant eligibility fact an answer to the deadline question', async () => {
  const s = scenario(); s.services.model = async () => ({value:{claims:[{statement:'仅限本科生',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'虽然原句存在，但不是截止日期'}],answerBlocks:[{text:'仅限本科生',claimIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result = await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial'); expect(result.stopReason).not.toBe('answered'); expect(result.draft?.unknowns.join(' ')).toMatch(/核心|截止/);
});
it('uses an answered clarification as a field clue without replacing a punctuation-only original goal', async () => {
  const s=scenario();s.input.scope.goal='？';s.input.scope.knownClues=['2026年受控活动报名截止日期'];
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('completed');expect(result.draft?.scope.goal).toBe('？');expect(s.models).toHaveLength(1);
});
it('uses at most one bounded semantic review for a nonliteral inference with an actual source quote', async () => {
  const s = scenario(); s.input.scope.goal='controlled_fixture：活动何时结束报名？'; let count=0;
  s.services.model = async request => {
    s.models.push(request); count++;
    return {value:count===1?{claims:[{statement:'十月底结束报名',status:'supported',links:[{evidenceIndex:0,relation:'supports',quote:'报名截止2026年10月30日',rationale:'截止时间'}],conditions:['仅限本科生'],gaps:[],reasonSummary:'时间归纳'}],answerBlocks:[]}:{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'十月三十日处于十月底，原句与限定对应。'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'回答结束报名时间并保留限定'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};
  };
  const result = await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(count).toBe(2); expect(result.completion).toBe('completed'); expect(result.draft?.claims[0]?.conditions).toContain('仅限本科生');
});
it('does not ask a model repeatedly to become more certain after semantic review rejects a claim', async () => {
  const s = scenario(); let count=0;
  s.services.model = async () => ({value:++count===1?{claims:[{statement:'活动提供住宿',status:'supported',links:[{evidenceIndex:0,relation:'supports',quote:'报名截止2026年10月30日',rationale:'受控坏推断'}],conditions:[],gaps:[],reasonSummary:'无关推断'}],answerBlocks:[]}:{checks:[{claimIndex:0,verdict:'insufficient',reason:'截止日期不能证明住宿。'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result = await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(count).toBe(2); expect(result.completion).toBe('partial'); expect(result.draft?.claims[0]?.status).toBe('insufficient');
});
it('does not accept a quoted statement which the same source explicitly corrects', async () => {
  const s=scenario();const read=s.services.read;
  s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2026年受控活动：“报名截止2026年10月30日”是错误信息，实际报名截止2026年10月20日。'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.claims.some(c=>c.status==='supported')).not.toBe(true);
});
it('does not equate substring presence in a denied assertion with semantic support', async () => {
  const s=scenario();const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2026年受控活动报名截止2026年10月30日这一说法已被官方否认。'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.claims.some(c=>c.status==='supported')).not.toBe(true);
});
it('carries edition headers into facts in a different paragraph', async () => {
  const s=scenario();s.input.scope.goal='controlled_fixture：2026年受控活动是否免费？';const read=s.services.read;
  s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2024年受控活动通知\n\n活动免费。'});
  s.services.model=async()=>({value:{claims:[{statement:'活动免费',status:'supported',evidenceIndexes:[1],conditions:[],gaps:[],reasonSummary:'原句存在'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/届|年份|2026/);
});
it('does not treat site navigation before an old-edition heading as a current edition', async () => {
  const s=scenario();const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'网站首页\n\n2024年受控活动通知\n\n报名截止10月30日。'});
  s.services.model=async()=>({value:{claims:[{statement:'报名截止10月30日',status:'supported',evidenceIndexes:[2],conditions:[],gaps:[],reasonSummary:'原句存在'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/届|年份|2026/);
});
it('requires actual question coverage for topics outside a handcoded keyword list', async () => {
  const s=scenario();s.input.scope.goal='controlled_fixture：2026年受控活动能否获得学分？';
  s.services.model=async()=>({value:{claims:[{statement:'仅限本科生',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'资格与学分是两件事'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/核心|问题/);
});
it('does not discard a core question before a colon to take the deadline fast path', async () => {
  const s=scenario();s.input.scope.goal='能否获得学分：报名截止日期？';
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/核心|问题/);
});
it('marks omitted capture paragraphs as incomplete even when each selected paragraph is short', async () => {
  const s=scenario();const read=s.services.read;
  s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2026年受控活动报名截止2026年10月30日。\n\n2026年受控活动名称说明。\n\n2026年受控活动背景说明。\n\n该日期仅适用于境外申请者，境内申请者截止时间为十月二十日。'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/片段|条件|展示/);
});

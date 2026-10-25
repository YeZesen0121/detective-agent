import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ClaimSchema, type Claim, type Evidence, type Scope, type ResultPayload } from '../../shared/contracts.js';
import type { WorkingMaterial } from '../../shared/ports.js';
import { normalizedView, quoteRange } from './evidence.js';
import { atomicGoals, uncoveredGoalMessage } from './goals.js';

const text = z.string().trim().min(1).max(4000);
const draftClaim = z.object({ statement:text,status:z.enum(['supported','refuted','mixed','insufficient']),evidenceIds:z.array(z.string()).max(80).optional(),evidenceIndexes:z.array(z.number()).max(80).optional(),
  links:z.array(z.object({evidenceIndex:z.number().optional(),evidenceId:z.string().optional(),relation:z.enum(['supports','contradicts','qualifies','background']),quote:text.optional(),rationale:z.string().max(1000).optional()})).max(80).optional(),conditions:z.array(text).max(80).default([]),gaps:z.array(text).max(80).default([]),reasonSummary:text.default('没有提供充分的材料解释。') });
const DraftSchema = z.object({claims:z.array(draftClaim).max(80).default([]),answerBlocks:z.array(z.object({text:z.string().max(12000),claimIndexes:z.array(z.number()).optional(),claimIds:z.array(z.string()).optional(),evidenceIndexes:z.array(z.number()).optional(),evidenceIds:z.array(z.string()).optional()})).max(100).default([])});
// Send only the ambiguous field types, derived from the exact validator rather
// than duplicating its constraints or charging for a full schema on every call.
const claimFieldTypes=Object.fromEntries((['conditions','gaps'] as const).map(field=>{
  const schema=z.toJSONSchema(draftClaim.shape[field],{io:'input'});
  const items=schema.items;
  return [field,{type:schema.type,maxItems:schema.maxItems,items:{type:items&&typeof items==='object'&&!Array.isArray(items)?items.type:undefined}}];
}));
export const evaluationOutputContract={claims:claimFieldTypes};
export interface Judgement { claims: Claim[]; unknowns: string[]; needsReview: number[]; invalidRefs: boolean; fatalInvalidRefs:boolean; quarantinedClaimIndexes:number[]; needsCoverageReview: boolean; goals:string[];coveredGoals:number[];goalClaims:number[][];conflicts?:ResultPayload['conflicts'] }
const uniq = (items: string[]) => [...new Set(items)].slice(0,80);
const restrictions = (evidence: Evidence) => evidence.excerpt.match(/(?:仅(?:限|适用|对|供)|只(?:限|适用|对|供)|不适用|除[^。；;\n]{0,30}外)[^。；;\n]{0,100}/g) ?? [];

export function judge(value: unknown, material: WorkingMaterial, scope: Scope, selected: number[]): Judgement {
  const parsed = DraftSchema.safeParse(value);
  const goalsToCover=atomicGoals(scope);
  if (!parsed.success) return {claims:[],unknowns:['模型输出结构无法核验。'],needsReview:[],invalidRefs:true,fatalInvalidRefs:true,quarantinedClaimIndexes:[],needsCoverageReview:false,goals:goalsToCover,coveredGoals:[],goalClaims:goalsToCover.map(()=>[])};
  const supplied = new Set(selected.map(i=>material.evidence[i]!.id));
  const evidenceIndex = (index: number) => Number.isInteger(index)&&selected.includes(index)?material.evidence[index]:undefined;
  const byId = (id: string) => supplied.has(id)?material.evidence.find(e=>e.id===id):undefined;
  let invalidRefs = false; const unknowns: string[] = []; const needsReview: number[] = [];const quarantinedClaimIndexes:number[]=[];
  const scopeYears = [...new Set((scope.objectText+' '+scope.goal+' '+(scope.timeScope??'')).match(/\b20\d{2}\b/g) ?? [])];
  const claims = parsed.data.claims.map((raw,index) => {
    let invalidClaim=false;
    const refs: {evidence:Evidence;relation:'supports'|'contradicts'|'qualifies'|'background';quote?:string;rationale:string}[] = [];
    const push = (e: Evidence | undefined,relation:'supports'|'contradicts'|'qualifies'|'background',quote?:string,rationale=raw.reasonSummary) => { if(!e){invalidClaim=true;return;} refs.push({evidence:e,relation,...(quote?{quote}:{}),rationale:rationale.slice(0,1000)}); };
    if((raw.evidenceIds??[]).some(id=>!byId(id))||(raw.evidenceIndexes??[]).some(index=>!evidenceIndex(index)))invalidClaim=true;
    if(raw.links?.length) for(const link of raw.links) {
      const idRef=link.evidenceId!==undefined?byId(link.evidenceId):undefined,indexRef=link.evidenceIndex!==undefined?evidenceIndex(link.evidenceIndex):undefined;
      if((link.evidenceId!==undefined&&!idRef)||(link.evidenceIndex!==undefined&&!indexRef)||(idRef&&indexRef&&idRef.id!==indexRef.id))invalidClaim=true;
      push(idRef??indexRef,link.relation,link.quote,link.rationale);
    }
    else {
      const relation = raw.status==='refuted'?'contradicts':'supports';
      for(const id of raw.evidenceIds??[])push(byId(id),relation);
      for(const at of raw.evidenceIndexes??[])push(evidenceIndex(at),relation);
    }
    if(raw.status!=='insufficient'&&!refs.length)invalidClaim=true;
    let status = raw.status; const gaps = [...raw.gaps]; const conditions = [...raw.conditions]; let requiresReview = false;
    const downgrade = (reason: string) => {status='insufficient';gaps.push(reason);unknowns.push(reason);};
    for(const ref of refs) {
      const source = ref.evidence.origin.kind==='source'?material.sources.find(s=>s.id===ref.evidence.origin.id):undefined;
      conditions.push(...material.evidence.filter(e=>e.origin.id===ref.evidence.origin.id&&!e.limitations.some(l=>l.startsWith('raw_capture_only'))).flatMap(restrictions));
      if(!source || ref.evidence.representation==='snippet' || !['full','partial'].includes(source.readStatus)) downgrade('只有摘要或未读取正文，不能核实命题。');
      if(source?.readStatus==='partial' || ref.evidence.limitations.some(s=>/capture_partial|excerpt_only|capture_context_risk/.test(s))) downgrade('正文或证据片段截断/未全部展示关键例外，完整适用条件仍需核对。');
      if(ref.evidence.limitations.some(s=>s.startsWith('capture_selection_partial'))) {requiresReview=true;unknowns.push('模型仅核对选中片段，未展示背景不能证明不存在其他条件。');}
      const years: string[] = ref.evidence.excerpt.match(/\b20\d{2}\b/g) ?? [];
      if(scopeYears.length && years.length && !scopeYears.some(year=>years.includes(year))) downgrade(`材料届次/年份与${scopeYears.join('/')}调查范围不一致。`);
      const headerYears: string[] = ref.evidence.limitations.filter(s=>s.startsWith('capture_header_years:')).flatMap(s=>s.slice('capture_header_years:'.length).split(','));
      if(scopeYears.length&&headerYears.length&&!scopeYears.some(year=>headerYears.includes(year))) downgrade(`捕获标题届次/年份与${scopeYears.join('/')}调查范围不一致。`);
      if(ref.quote && !quoteRange(ref.evidence.excerpt,ref.quote)) { invalidClaim=true; continue; }
      const literal = quoteRange(ref.evidence.excerpt,raw.statement);
      const prefix = literal?ref.evidence.excerpt.slice(Math.max(0,literal.start-6),literal.start):'';
      const following = literal?ref.evidence.excerpt.slice(literal.end,literal.end+80):'';
      const negated = /(?:并非|不是|不再|不|未|不能)[^。；;]{0,4}$/.test(prefix);
      const corrected = /(?:错误信息|错误说法|不实|谣言|辟谣|更正|实际(?:为|截止|报名))/.test(following);
      if(ref.relation==='supports'&&(negated||corrected)) downgrade('引句处于否定或纠错语境，不能支持原断言。');
      const quoted = /[“「\"']/.test(prefix+following.slice(0,3));
      const compact = (value:string) => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'');
      const lead = literal?compact(ref.evidence.excerpt.slice(0,literal.start)):'';
      const tail = literal?compact(ref.evidence.excerpt.slice(literal.end)):'';
      const allowedLead = ['',compact(scope.objectText),'报名',compact(scope.objectText)+'报名'].includes(lead);
      const allowedTail = !tail || tail===compact(restrictions(ref.evidence).join(''));
      // Presence inside a larger assertion is never treated as an assertion by the source.
      // Only a stand-alone field value plus explicit captured conditions takes the cheap path.
      const directSupport = literal && allowedLead && allowedTail && !negated && !corrected && !quoted && ref.relation==='supports';
      const directRefutation = literal && negated && ref.relation==='contradicts';
      if(!directSupport&&!directRefutation && ['supports','contradicts'].includes(ref.relation)) requiresReview=true;
      if(ref.quote && normalizedView(ref.evidence.excerpt).text.includes(normalizedView(ref.quote).text) && !ref.evidence.excerpt.includes(ref.quote)) conditions.push('引句使用规范化视图定位，原文保留Markdown转义。');
    }
    const relations = new Set(refs.map(r=>r.relation));
    if(status!=='insufficient'&&relations.has('supports')&&relations.has('contradicts'))status='mixed';
    if(raw.status==='mixed'&&(!relations.has('supports')||!relations.has('contradicts'))) downgrade('冲突缺少分别可核验的支持与反对证据。');
    if(raw.status==='supported'&&!relations.has('supports')) downgrade('没有支持关系的证据。');
    if(raw.status==='refuted'&&!relations.has('contradicts')) downgrade('没有反驳关系的证据。');
    if(invalidClaim){invalidRefs=true;quarantinedClaimIndexes.push(index);status='insufficient';const reason=`命题[${index}]引用非法或引句无法定位，整项未采用，不以剩余链接补救。`;gaps.unshift(reason);unknowns.push(reason);}
    if(status!=='insufficient'&&requiresReview)needsReview.push(index);
    const prior = material.claims.find(c=>c.statement===raw.statement);
    return ClaimSchema.parse({id:prior?.id??randomUUID(),statement:raw.statement,status,conditions:invalidClaim?[]:uniq(conditions),gaps:uniq(gaps),reasonSummary:invalidClaim?'该命题包含非法或不可定位引用，整项隔离，未作为结论依据。':raw.reasonSummary,
      links:invalidClaim?[]:refs.map(ref=>({evidenceId:ref.evidence.id,relation:ref.relation,rationale:ref.rationale,...(ref.quote?{quote:ref.quote}:{})})).filter((ref,i,all)=>all.findIndex(other=>other.evidenceId===ref.evidenceId&&other.relation===ref.relation&&other.quote===ref.quote)===i)});
  });
  for(const block of parsed.data.answerBlocks) {
    const invalidBlock=(block.claimIndexes??[]).some(i=>!Number.isInteger(i)||i<0||i>=claims.length||quarantinedClaimIndexes.includes(i)) || (block.claimIds??[]).some(id=>!claims.some((c,index)=>c.id===id&&!quarantinedClaimIndexes.includes(index))) || (block.evidenceIndexes??[]).some(i=>!evidenceIndex(i)) || (block.evidenceIds??[]).some(id=>!byId(id)) || (block.text.trim() && !(block.claimIndexes?.length||block.claimIds?.length||block.evidenceIndexes?.length||block.evidenceIds?.length));
    if(invalidBlock){invalidRefs=true;unknowns.push('模型回答块包含非法引用或被隔离命题，展示块未采用；结果仅从独立核验内容重建。');}
  }
  const answeredStatements = claims.filter(c=>c.status!=='insufficient').map(c=>c.statement).join('；');
  const workingGoal = /[^\p{P}\p{Z}\s]/u.test(scope.goal) ? scope.goal : scope.knownClues.join('；') || scope.goal;
  const goals: [RegExp,RegExp,string][] = [
    [/截止|截至|deadline|报名.*日期|何时.*报名|结束报名/i,/截止|截至|延期|报名时间|结束报名|deadline/i,'核心截止日期尚未得到回答。'],
    [/免费|费用|收费|fee|price/i,/免费|费用|收费|金额|fee|price/i,'核心费用命题尚未得到回答。'],
    [/住宿|accommodation/i,/住宿|accommodation/i,'核心住宿命题尚未得到回答。'],
  ];
  for(const [question,answer,gap] of goals) if(question.test(workingGoal)&&!answer.test(answeredStatements))unknowns.push(gap);
  // Only an unambiguous extractive deadline-field query can use the literal fast path.
  // Every other/compound question needs explicit semantic coverage; unknown topics are never assumed answered.
  const question = workingGoal.trim();
  const field = question.match(/(?:请)?(?:核对)?(?:报名)?(?:截止|截至)(?:日期|时间)(?:是什么)?[?？。\s]*$/);
  const lead = field?question.slice(0,field.index).trim().replace(/[:：]\s*$/,'').trim():'';
  const entityPrefix = lead===scope.objectText || (/^[A-Za-z][A-Za-z0-9._ \-]*$/.test(lead)&&scope.objectText.startsWith(lead));
  const directFieldQuestion = !!field && (!lead || (entityPrefix&&!/[?？]|是否|能否|以及|同时|和|并且/.test(lead)));
  // Excluding a candidate value preserves that refutation, but does not supply the requested value.
  // Only a complete field-value assertion qualifies. A date anywhere in a sentence
  // may be a publication time ("截至...，截止日期未公布"), not the requested value.
  const supportedDeadline=claims.some(claim=>{
    const statement=(claim.statement.startsWith(scope.objectText)?claim.statement.slice(scope.objectText.length):claim.statement).trim();
    return claim.status==='supported' && /^(?:报名)?(?:截止|截至)(?:日期|时间)?(?:是|为|于)?(?:[0-9一二三四五六七八九十零〇]+年)?[0-9一二三四五六七八九十廿]+月[0-9一二三四五六七八九十廿]+(?:日|号)[。.]?$/u.test(statement);
  });
  if(directFieldQuestion&&!supportedDeadline)unknowns.push('核心截止日期尚未得到回答：排除候选日期或确认其他事实不等于得到实际日期。');
  const needsCoverageReview = goalsToCover.length!==1||scope.basicMode!=='truth'||!directFieldQuestion;
  if(needsCoverageReview) claims.forEach((claim,index)=>{if(claim.status!=='insufficient'&&!needsReview.includes(index))needsReview.push(index);});
  return {claims,unknowns:uniq([...unknowns,...claims.flatMap(c=>c.gaps)]),needsReview,invalidRefs,fatalInvalidRefs:false,quarantinedClaimIndexes,needsCoverageReview,goals:goalsToCover,coveredGoals:!needsCoverageReview&&supportedDeadline?[0]:[],goalClaims:goalsToCover.map(()=>!needsCoverageReview&&supportedDeadline?claims.flatMap((claim,index)=>claim.status==='supported'?[index]:[]):[])};
}

export function reviewed(judgement: Judgement, value: unknown): Judgement {
  for(const index of judgement.quarantinedClaimIndexes){const claim=judgement.claims[index];if(claim){claim.status='insufficient';claim.links=[];}}
  const parsed = z.object({checks:z.array(z.object({claimIndex:z.number().int().nonnegative(),verdict:z.enum(['supported','refuted','mixed','insufficient']),addressesQuestion:z.boolean().optional(),reason:text})).max(80),goalChecks:z.array(z.object({goalIndex:z.number().int().nonnegative(),claimIndexes:z.array(z.number().int().nonnegative()).min(1).max(80),covered:z.boolean(),reason:text})).max(80).optional()}).safeParse(value);
  for(const index of judgement.needsReview) {
    const claim = judgement.claims[index]!;
    const checks = parsed.success?parsed.data.checks.filter(c=>c.claimIndex===index):[];
    if(checks.length!==1 || checks[0]!.verdict!==claim.status || (judgement.needsCoverageReview&&checks[0]!.addressesQuestion!==true)) {
      claim.status='insufficient'; claim.gaps=uniq([...claim.gaps,'语义复核未确认材料支持该命题。']);
      if(judgement.needsCoverageReview)claim.gaps=uniq([...claim.gaps,'核心问题与命题的对应关系未确认。']);
      judgement.unknowns=uniq([...judgement.unknowns,...claim.gaps]);
    } else claim.reasonSummary=checks[0]!.reason;
  }
  if(parsed.success&&parsed.data.goalChecks) {
    judgement.coveredGoals=judgement.goals.flatMap((_goal,index)=>{
      const entries=parsed.data.goalChecks!.filter(row=>row.goalIndex===index);
      const covered=entries.length===1&&entries[0]!.covered&&entries[0]!.claimIndexes.every(i=>!judgement.quarantinedClaimIndexes.includes(i)&&judgement.claims[i]&&judgement.claims[i]!.status!=='insufficient');
      judgement.goalClaims[index]=covered?[...new Set(entries[0]!.claimIndexes)]:[];
      return covered?[index]:[];
    });
  }
  judgement.unknowns=uniq([...judgement.unknowns,...judgement.goals.flatMap((goal,index)=>judgement.coveredGoals.includes(index)?[]:[uncoveredGoalMessage(goal,index)])]);
  return judgement;
}

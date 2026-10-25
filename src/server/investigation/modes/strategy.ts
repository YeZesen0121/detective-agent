import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CandidateSchema, TimestampSchema, type Scope } from '../../../shared/contracts.js';
import type { WorkingMaterial } from '../../../shared/ports.js';
import type { Judgement } from '../judge.js';
import { normalizedView, quoteRange } from '../evidence.js';
import { identityGoalIndexes } from '../goals.js';

export function modeInstruction(scope: Scope) {
  if(scope.basicMode==='latest')return '查最新：区分publication/fetch与effective时间，只用有引句证明的有效时间排序。另输出latestFacts:[{claimIndex,evidenceIndex,effectiveAt:ISO8601或null,quote}]，日期不能猜，旧届或发布时间不得冒充有效时间。';
  if(scope.basicMode==='identify')return '查模糊：保持用户确定/不确定线索，不强选一个。另输出candidates:[{name,aliases,evidenceIndexes,matchedClues,conflictingClues,missingClues,reasonSummary}]，名称和匹配线索须在材料中；允许多个候选，不给匹配百分比。';
  return '查真假：保留同一适用范围的支持/反对/限定。links逐条给relation与引句，冲突输出mixed，不用转载数量投票。';
}
export const hasCandidates = (value: unknown) => z.object({candidates:z.array(z.unknown()).min(1).max(20)}).safeParse(value).success;
const narrow = (s:string) => normalizedView(s).text.toLowerCase().replace(/[\s\p{P}]+/gu,'');
const uniq = (values:string[])=>[...new Set(values)].slice(0,80);
const hardConflicts=(candidate:WorkingMaterial['candidates'][number])=>candidate.conflictingClues.filter(clue=>!clue.startsWith('不确定记忆'));
export function resolvedIdentity(material:WorkingMaterial) {
  const full=material.candidates.filter(candidate=>!hardConflicts(candidate).length&&!candidate.missingClues.some(clue=>!clue.startsWith('不确定记忆'))&&candidate.matchedClues.some(clue=>!clue.startsWith('不确定记忆')));
  return full.length===1&&material.candidates.every(candidate=>candidate===full[0]||hardConflicts(candidate).length>0)?full[0]!:null;
}

export function applyMode(input: {scope:Scope}, material:WorkingMaterial, judgement:Judgement, value:unknown, audit:unknown, selected:number[]) {
  if(input.scope.basicMode==='latest') latest(input.scope,material,judgement,value,audit,selected);
  if(input.scope.basicMode==='identify') identify(input.scope,material,judgement,value,audit,selected);
}
function latest(scope:Scope, material:WorkingMaterial, judgement:Judgement, value:unknown, audit:unknown, selected:number[]) {
  const parsed=z.object({latestFacts:z.array(z.object({claimIndex:z.number().int().nonnegative(),evidenceIndex:z.number().int().nonnegative(),effectiveAt:TimestampSchema.nullable(),quote:z.string().min(1).max(4000)})).max(80)}).safeParse(value);
  const accepted=new Map<number,string[]>();
  const sourceDates=new Map<string,Set<string>>();
  for(const row of parsed.success?parsed.data.latestFacts:[]) {
    const claim=judgement.claims[row.claimIndex], evidence=material.evidence[row.evidenceIndex];
    if(!claim||judgement.quarantinedClaimIndexes.includes(row.claimIndex)||claim.status==='insufficient'||!evidence||!selected.includes(row.evidenceIndex)||!row.effectiveAt||!claim.links.some(l=>l.evidenceId===evidence.id)||!quoteRange(evidence.excerpt,row.quote))continue;
    const [year,month,day]=row.effectiveAt.slice(0,10).split('-');
    const forms=[`${year}-${month}-${day}`,`${year}年${Number(month)}月${Number(day)}日`,`${year}年${month}月${day}日`];
    // The cue must bind this exact date, not another date in the same sentence.
    const bound=forms.some(date=>[...row.quote.matchAll(new RegExp(date,'g'))].some(match=>{
      const lead=row.quote.slice(Math.max(0,match.index!-30),match.index!).trimEnd();
      const tail=row.quote.slice(match.index!+date.length).trimStart();
      return /(?:自|从|截至|截止(?:日期|时间)?(?:为|是|至|到)?|(?:生效|施行|活动|报名)(?:日期|时间)(?:为|是|自|从|于|至)?|(?:生效|施行)(?:于|自|时间为)?)[：:\s]*$/.test(lead)
        || /^(?:起|开始(?:生效|施行)|生效|施行)/.test(tail);
    }));
    if(!bound||Date.parse(row.effectiveAt)>Date.parse(scope.referenceTime))continue;
    const source=material.sources.find(s=>s.id===evidence.origin.id);if(!source||source.readStatus!=='full')continue;
    accepted.set(row.claimIndex,[...new Set([...(accepted.get(row.claimIndex)??[]),row.effectiveAt])]);
    const dates=sourceDates.get(source.id)??new Set<string>();dates.add(row.effectiveAt);sourceDates.set(source.id,dates);
  }
  for(const source of material.sources) {
    const dates=sourceDates.get(source.id);source.eventAt=dates?.size===1?[...dates][0]!:null;
  }
  const keep=new Set<number>();
  // Undated or multiply-dated assertions remain visible as unknowns. A dated
  // historical assertion cannot silently erase an undated conflicting update.
  for(const [index,claim] of judgement.claims.entries()) {
    const dates=accepted.get(index);
    if(dates?.length!==1) {
      claim.status='insufficient';claim.gaps=uniq([...claim.gaps,'缺少唯一可核对的有效日期，不能确认该状态是否最新。']);
      keep.add(index);judgement.unknowns.push('核心最新有效时间未知，未定日期的材料不能被有日期的旧状态压掉。');
    }
  }
  const relations=z.object({temporalRelations:z.array(z.object({previousClaimIndex:z.number().int().nonnegative(),nextClaimIndex:z.number().int().nonnegative(),relation:z.enum(['supersedes','cumulative','conflicts']),reason:z.string().min(1).max(4000)})).max(80)}).safeParse(audit);
  // Dates order observations; they do not themselves prove that a fact was
  // revoked. Only a reviewed, same-goal replacement relation can remove it.
  for(const indexes of judgement.goalClaims) {
    const dated=indexes.filter(index=>accepted.get(index)?.length===1);
    if(!dated.length)continue;
    const superseded=new Set<number>();
    for(const older of dated)for(const newer of dated) {
      if(Date.parse(accepted.get(older)![0]!)>=Date.parse(accepted.get(newer)![0]!))continue;
      const checks=relations.success?relations.data.temporalRelations.filter(row=>row.previousClaimIndex===older&&row.nextClaimIndex===newer):[];
      if(checks.length!==1) {judgement.unknowns.push('核心时间关系未确认：后续材料可能新增、取代或冲突，不能只按日期删除条件。');continue;}
      if(checks[0]!.relation==='supersedes'&&!judgement.conflicts?.some(conflict=>conflict.claimIds.includes(judgement.claims[older]!.id)||conflict.claimIds.includes(judgement.claims[newer]!.id)))superseded.add(older);
      if(checks[0]!.relation==='conflicts')judgement.unknowns.push('核心时间材料存在未解决冲突，保留双方及有效日期。');
    }
    for(const index of dated.filter(index=>!superseded.has(index))) {
      keep.add(index);
      const claim=judgement.claims[index]!;
      const at=accepted.get(index)![0]!;
      claim.conditions=uniq([...claim.conditions,`截至查询时间${scope.referenceTime}，仅确认有效时间${at}所对应的材料范围。`]);
    }
  }
  for(const index of accepted.keys())if(!judgement.goalClaims.some(indexes=>indexes.includes(index))) {
    keep.add(index);judgement.unknowns.push('核心最新事实与原子目标的对应关系尚未确认。');
  }
  const oldClaims=judgement.claims;
  judgement.claims=oldClaims.filter((_claim,index)=>keep.has(index));
  judgement.coveredGoals=judgement.coveredGoals.filter(goal=>judgement.goalClaims[goal]?.some(index=>keep.has(index)&&oldClaims[index]?.status!=='insufficient'));
  judgement.goalClaims=judgement.goalClaims.map(indexes=>indexes.filter(index=>keep.has(index)).map(index=>judgement.claims.indexOf(oldClaims[index]!)));
  if(!accepted.size)judgement.unknowns.push('核心最新有效时间未知，发布时间和抓取时间不代替有效时间。');
  judgement.unknowns=uniq(judgement.unknowns);
}
function identify(scope:Scope,material:WorkingMaterial,judgement:Judgement,value:unknown,audit:unknown,selected:number[]) {
  const parsed=z.object({candidates:z.array(z.object({name:z.string().trim().min(1).max(256),aliases:z.array(z.string()).max(20).default([]),evidenceIndexes:z.array(z.number().int().nonnegative()).min(1).max(120),matchedClues:z.array(z.string()).max(80).default([]),conflictingClues:z.array(z.string()).max(80).default([]),missingClues:z.array(z.string()).max(80).default([]),reasonSummary:z.string().min(1).max(4000)})).max(20)}).safeParse(value);
  const checks=z.object({candidateChecks:z.array(z.object({candidateIndex:z.number().int().nonnegative(),grounded:z.boolean(),identityGoalIndexes:z.array(z.number().int().nonnegative()).max(80).optional(),clueChecks:z.array(z.object({clueIndex:z.number().int().nonnegative(),clueKind:z.enum(['known','uncertain']),clueText:z.string().max(256).optional(),relation:z.enum(['matches','conflicts','unknown']),evidenceIndex:z.number().int().nonnegative(),quote:z.string().min(1).max(1400),reason:z.string().min(1).max(1000)})).max(80).optional(),reason:z.string()})).max(20)}).safeParse(audit);
  material.candidates=[];
  const identityGoals=new Map<string,number[]>();
  const allowedIdentityGoals=new Set(identityGoalIndexes(scope));
  for(const [index,raw] of (parsed.success?parsed.data.candidates:[]).entries()) {
    const evidence=raw.evidenceIndexes.map(i=>selected.includes(i)?material.evidence[i]:undefined);
    if(evidence.some(e=>!e)||!evidence.some(e=>narrow(e!.excerpt).includes(narrow(raw.name))))continue;
    const sourceIds=uniq(evidence.map(e=>e!.origin.id));
    if(sourceIds.some(id=>!material.sources.some(s=>s.id===id&&s.readStatus==='full')))continue;
    if(evidence.some(e=>e!.limitations.some(limit=>/capture_partial|excerpt_only|capture_context_risk/.test(limit)))) {
      judgement.unknowns.push('核心候选线索仍有截断、遗漏条件或反证，不能确认对象。');continue;
    }
    const auditRows=checks.success?checks.data.candidateChecks.filter(c=>c.candidateIndex===index):[];
    const row=auditRows.length===1?auditRows[0]:undefined;
    const clueRows=row?.clueChecks;const keys=new Set<string>();
    const boundRows=!!clueRows&&clueRows.length===scope.knownClues.length+scope.uncertainClues.length&&clueRows.every(check=>{const clues=check.clueKind==='known'?scope.knownClues:scope.uncertainClues;const key=check.clueKind+':'+check.clueIndex;const cited=raw.evidenceIndexes.includes(check.evidenceIndex)&&selected.includes(check.evidenceIndex)?material.evidence[check.evidenceIndex]:undefined;if(!clues[check.clueIndex]||check.clueText!==clues[check.clueIndex]||keys.has(key)||!cited||!quoteRange(cited.excerpt,check.quote))return false;keys.add(key);return true;});
    const invalidAudit=auditRows.length>1||!!row?.grounded&&!boundRows;
    const grounded=auditRows.length===1&&!!row?.grounded&&boundRows;
    if(invalidAudit)judgement.unknowns.push('核心候选线索审核索引或文本不对应，整项审核未采用，未猜测重映射。');
    const auditRow=auditRows.length===1?auditRows[0]:undefined;
    const matchedClues:string[]=[],conflictingClues:string[]=[],unmatched:string[]=[];
    if(grounded&&auditRow?.clueChecks) {
      for(const [kind,clues] of [['known',scope.knownClues],['uncertain',scope.uncertainClues]] as const)for(const [clueIndex,clue] of clues.entries()) {
        const rows=auditRow.clueChecks.filter(row=>row.clueKind===kind&&row.clueIndex===clueIndex);
        const row=rows[0];const captured=row&&raw.evidenceIndexes.includes(row.evidenceIndex)&&selected.includes(row.evidenceIndex)?material.evidence[row.evidenceIndex]:undefined;
        const relation=rows.length===1&&captured&&quoteRange(captured.excerpt,row!.quote)?row!.relation:'unknown';
        const label=kind==='uncertain'?'不确定记忆：'+clue:clue;
        if(relation==='matches')matchedClues.push(label);else if(relation==='conflicts')conflictingClues.push(label);else unmatched.push(kind==='uncertain'?'不确定记忆待核对：'+clue:clue);
      }
    } else unmatched.push(...scope.knownClues,...scope.uncertainClues.map(clue=>'不确定记忆待核对：'+clue));
    const missing=uniq([...(invalidAudit?['候选线索审核索引或文本无效，整项审核待重新核对。']:[]),...raw.missingClues,...(!grounded?['匹配线索尚未通过语义核对。']:[]),...unmatched]);
    const aliases=raw.aliases.filter(alias=>evidence.some(e=>quoteRange(e!.excerpt,alias)));
    const candidate=CandidateSchema.safeParse({id:randomUUID(),name:raw.name,aliases,sourceIds,matchedClues,conflictingClues,missingClues:missing,reasonSummary:raw.reasonSummary});
    if(candidate.success&&!material.candidates.some(c=>narrow(c.name)===narrow(candidate.data.name))) {
      material.candidates.push(candidate.data);
      if(grounded&&checks.success)identityGoals.set(candidate.data.id,(auditRow!.identityGoalIndexes??[]).filter(goal=>allowedIdentityGoals.has(goal)));
    }
  }
  const resolved=resolvedIdentity(material);
  if(!resolved)judgement.unknowns.push('核心对象仍有歧义，请补充候选的地点、年份或其他区分线索。');
  else {
    const coveredIdentityGoals=identityGoals.get(resolved.id)??[];
    judgement.coveredGoals=[...new Set([...judgement.coveredGoals,...coveredIdentityGoals.filter(index=>!!judgement.goals[index])])];
    judgement.unknowns=judgement.unknowns.filter(gap=>!coveredIdentityGoals.some(index=>gap.startsWith(`核心目标未覆盖[${index}]：`)));
  }
}

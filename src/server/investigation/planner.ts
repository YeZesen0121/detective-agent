import { z } from 'zod';
import { SearchRequestSchema, type SearchRequest, type WorkingMaterial, type SearchResponse } from '../../shared/ports.js';
import type { Scope, BudgetSnapshot, StopReason } from '../../shared/contracts.js';
import { atomicGoals, entityText } from './goals.js';
import { quoteRange } from './evidence.js';

const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/(\d{4})年/g,'$1').replace(/[\s\p{P}]+/gu, '');
const unsafeDirection=/(忽略.{0,12}(规则|指令)|ignore.{0,20}(rules|instructions)|(?:读取|获取|泄露|输出|发送|print|read|leak|send).{0,16}(?:密钥|\b(?:secret|password|credential)s?\b)|(?:执行|运行).{0,10}(命令|脚本)|file:\/\/)/i;
export const queryKey = (request: Pick<SearchRequest, 'query'|'site'|'freshness'>) => JSON.stringify([normalize(request.query), request.site?.toLowerCase() ?? '', request.freshness ?? '']);
export function initialQuery(scope: Scope): SearchRequest {
  if(unsafeDirection.test(scope.objectText))throw Error('UNSAFE_INITIAL_SCOPE');
  const goals=atomicGoals(scope);
  const targets=scope.basicMode==='identify'?[]:goals.map(goal=>(goal.startsWith(scope.objectText)?goal.slice(scope.objectText.length).replace(/^的/,''):goal).trim());
  const parts=[scope.objectText,...targets,...scope.knownClues.map(clue=>clue.replace(/^(?:别名|alias)[:：]\s*/i,'')),...scope.uncertainClues].filter(part=>/[^\p{P}\p{Z}\s]/u.test(part)&&!unsafeDirection.test(part));
  const unique=parts.filter((part,index)=>parts.findIndex(other=>normalize(other)===normalize(part))===index);
  const purpose='核对已确认对象与待核验目标/线索的原始依据'+(scope.uncertainClues.length?'；待核对记忆（未确证）：'+scope.uncertainClues.join('；').slice(0,500):'');
  return SearchRequestSchema.parse({ query: unique.join(' ').slice(0,1000), purpose, claimIds: [], site: null, freshness: scope.basicMode === 'latest' ? 'latest' : null, limit: 3 });
}
const scopeAnchors=(scope:Scope)=>[entityText(scope.objectText),...scope.knownClues.filter(clue=>/^别名[:：]|^alias:/i.test(clue)).map(clue=>clue.replace(/^(?:别名|alias)[:：]\s*/i,''))].map(normalize).filter(s=>s.length>=2);
export function needsQueryReview(value:unknown,scope:Scope,material?:WorkingMaterial):boolean {
  const proposals=z.object({nextQueries:z.array(z.object({query:z.string().max(1000)})).max(12)}).safeParse(value);
  const seen=new Set(material?.queries.map(queryKey)??[]);
  return proposals.success&&proposals.data.nextQueries.some(proposal=>!seen.has(queryKey({...initialQuery(scope),query:proposal.query})));
}
export function nextQueries(value: unknown, scope: Scope, material: WorkingMaterial, gaps: string[], uncoveredGoals?:number[], audit?:unknown, selectedEvidence?:number[]): SearchRequest[] {
  const parsed = z.object({ nextQueries: z.array(z.object({ query: z.string().trim().min(1).max(1000), purpose: z.string().trim().min(1).max(1000), gap: z.string().trim().min(1).optional(),goalIndex:z.number().int().nonnegative().optional(),claimIds: z.array(z.string().uuid()).optional() })).max(12).optional() }).safeParse(value);
  if (!parsed.success || !gaps.length) return [];
  const seen = new Set(material.queries.map(queryKey)); const claims = new Set(material.claims.map(c=>c.id)); const selected: SearchRequest[] = [];
  const anchors = scopeAnchors(scope);
  const checks=z.object({queryChecks:z.array(z.object({queryIndex:z.number().int().nonnegative(),scopeMatches:z.boolean(),goalIndex:z.number().int().nonnegative(),anchors:z.array(z.object({text:z.string().min(3).max(256),evidenceIndex:z.number().int().nonnegative(),quote:z.string().min(1).max(1400)})).max(4).default([]),reason:z.string().min(1).max(1000)})).max(12)}).safeParse(audit);
  for (const [index,proposal] of (parsed.data.nextQueries ?? []).entries()) {
    const goalBound=proposal.goalIndex!==undefined&&uncoveredGoals?.includes(proposal.goalIndex)&&!!atomicGoals(scope)[proposal.goalIndex];
    if(proposal.goalIndex!==undefined&&!goalBound)continue;
    if (!(goalBound||(proposal.gap&&gaps.includes(proposal.gap)))) continue;
    const direct=anchors.some(anchor=>normalize(proposal.query).includes(anchor));
    const rows=checks.success?checks.data.queryChecks.filter(row=>row.queryIndex===index):[];
    const approved=rows.length===1&&rows[0]!.scopeMatches&&!!atomicGoals(scope)[rows[0]!.goalIndex]&&(uncoveredGoals??atomicGoals(scope).map((_goal,index)=>index)).includes(rows[0]!.goalIndex)&&(proposal.goalIndex===undefined||proposal.goalIndex===rows[0]!.goalIndex);
    const bound=approved&&rows[0]!.anchors.length>0&&rows[0]!.anchors.every(anchor=>{
      const evidence=material.evidence[anchor.evidenceIndex];
      return evidence&&(!selectedEvidence||selectedEvidence.includes(anchor.evidenceIndex))&&material.sources.some(source=>source.id===evidence.origin.id&&source.readStatus==='full')&&!evidence.limitations.some(limit=>/raw_capture_only|capture_partial|excerpt_only|capture_context_risk|capture_screen_unverified|capture_scope_unrelated/.test(limit))&&normalize(proposal.query).includes(normalize(anchor.text))&&quoteRange(evidence.excerpt,anchor.quote)&&quoteRange(anchor.quote,anchor.text);
    });
    if(!approved||(!direct&&!bound))continue;
    if (unsafeDirection.test(proposal.query+' '+proposal.purpose)) continue;
    const candidate = initialQuery(scope); candidate.query = proposal.query; candidate.purpose = proposal.purpose + '；缺口：' + (goalBound?atomicGoals(scope)[proposal.goalIndex!]:proposal.gap);
    candidate.claimIds = (proposal.claimIds ?? []).filter(id=>claims.has(id));
    const key = queryKey(candidate); if (seen.has(key)) continue;
    selected.push(candidate); seen.add(key); if (selected.length === 3) break;
  }
  return selected;
}
export function budgetStop(budget: BudgetSnapshot, operation: 'search'|'read'|'model'): StopReason | null {
  if(budget.unrestricted)return null;
  const r = budget.remaining;
  if (r.activeMs <= 0) return 'time_limit'; if (r.moneyMicros <= 0) return 'cost_limit';
  if (operation === 'search' && (r.searches <= 0 || !budget.canSearch)) return 'search_limit';
  if (operation === 'read' && (r.reads <= 0 || !budget.canRead)) return 'read_limit';
  if (operation === 'model') {
    if (r.inputTokens <= 0 || r.outputTokens <= 0) return 'token_limit';
    if (r.modelCalls <= 0 || !budget.canModel) return 'model_limit';
  }
  return null;
}
/** Search metadata ranks reading leads only; an 'official' label never proves the claim. */
export function readingCandidates(items:SearchResponse['items'],limit:number):SearchResponse['items'] {
  const score=(item:SearchResponse['items'][number])=>(/原始|原文|主办方|original|primary/i.test(item.title+' '+item.snippet)?4:0)-(/转载|转发|reprint/i.test(item.title)?2:0);
  const ranked=items.map((item,index)=>({item,index,score:score(item)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen:typeof ranked=[];const seen=new Set<string>();
  for(const entry of ranked) {
    const hint=normalize(entry.item.snippet);if(hint&&seen.has(hint))continue;
    chosen.push(entry);if(hint)seen.add(hint);if(chosen.length>=limit)break;
  }
  for(const entry of ranked) {if(chosen.length>=limit)break;if(!chosen.includes(entry))chosen.push(entry);}
  return chosen.sort((a,b)=>a.index-b.index).map(entry=>entry.item);
}

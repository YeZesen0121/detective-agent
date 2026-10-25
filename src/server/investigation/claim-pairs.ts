import {z} from 'zod';
import {ClaimSchema,type Scope} from '../../shared/contracts.js';
import type {WorkingMaterial} from '../../shared/ports.js';
import type {Judgement} from './judge.js';
import {answerEvidence,quoteRange} from './evidence.js';

export const MAX_CLAIM_PAIR_CHECKS=6;
const citation=z.object({evidenceIndex:z.number().int().nonnegative(),quote:z.string().min(1).max(1400)});
const PairSchema=z.object({claimPairChecks:z.array(z.object({leftClaimIndex:z.number().int().nonnegative(),rightClaimIndex:z.number().int().nonnegative(),objectText:z.string().min(1).max(1000),sameObject:z.boolean(),sameFactDimension:z.boolean(),sameConditions:z.boolean(),relation:z.enum(['conflicts','compatible','different_scope','different_dimension','cumulative','unknown']),left:citation,right:citation,reason:z.string().min(1).max(1000)})).max(MAX_CLAIM_PAIR_CHECKS)});
const unique=(values:string[])=>[...new Set(values)].slice(0,80);

/** The pair set follows reviewed goal ownership, never numerical/textual disagreement. */
export function reviewClaimPairs(judgement:Judgement,value:unknown,scope:Scope,material:WorkingMaterial,selected:number[]) {
 const pairGoals=judgement.goalClaims.flatMap((indexes,goal)=>new Set(indexes.filter(index=>judgement.claims[index]?.status!=='insufficient')).size>1?[goal]:[]);
 const gap=(message:string,goals=pairGoals)=>{const unresolved=new Set(goals);judgement.coveredGoals=judgement.coveredGoals.filter(goal=>!unresolved.has(goal));judgement.unknowns=unique([...judgement.unknowns,message]);};
 const active=judgement.claims.flatMap((claim,index)=>claim.status!=='insufficient'?[index]:[]),mapped=new Set(judgement.goalClaims.flat());
 if(active.length>1&&active.some(index=>!mapped.has(index)))gap('核心命题与目标的归属对照未完成，未映射的已支持命题不能绕过冲突核验。',judgement.coveredGoals);
 const wanted=new Map<string,[number,number]>();let overflow=false;
 groups:for(const indexes of judgement.goalClaims) {
  const eligible=[...new Set(indexes)].filter(index=>judgement.claims[index]?.status!=='insufficient'&&!judgement.quarantinedClaimIndexes.includes(index)).sort((a,b)=>a-b);
  for(let left=0;left<eligible.length;left++)for(let right=left+1;right<eligible.length;right++) {
   const a=eligible[left]!,b=eligible[right]!,key=a+':'+b;if(wanted.has(key))continue;
   if(wanted.size===MAX_CLAIM_PAIR_CHECKS){overflow=true;break groups;}wanted.set(key,[a,b]);
  }
 }
 if(!wanted.size)return;
 if(overflow)gap(`核心跨命题对照超过单次${MAX_CLAIM_PAIR_CHECKS}项容量，已支持命题保留，但冲突核验尚未完成。`);
 const parsed=PairSchema.safeParse(value);
 if(!parsed.success){gap('核心跨命题对照缺失或结构无效，逐条支持不等于整体无冲突。');return;}
 const rows=parsed.data.claimPairChecks;
 // Never salvage part of a malformed/extra audit into a claimed conflict.
 if(rows.some(row=>!wanted.has(row.leftClaimIndex+':'+row.rightClaimIndex))){gap('核心跨命题对照包含越界、逆序或不属于同一目标的项，整组对照未采用。');return;}
 const bound=(index:number,ref:z.infer<typeof citation>)=>{
  const claim=judgement.claims[index],evidence=selected.includes(ref.evidenceIndex)?material.evidence[ref.evidenceIndex]:undefined;
  return !!claim&&!!evidence&&claim.links.some(link=>link.evidenceId===evidence.id&&link.relation!=='background')&&answerEvidence(evidence)&&material.sources.some(source=>source.id===evidence.origin.id&&source.readStatus==='full')&&!!quoteRange(evidence.excerpt,ref.quote);
 };
 const accepted:typeof rows=[];
 for(const [key] of wanted) {
  const checks=rows.filter(row=>row.leftClaimIndex+':'+row.rightClaimIndex===key),row=checks[0];
  if(checks.length!==1||!row||row.objectText!==scope.objectText||!bound(row.leftClaimIndex,row.left)||!bound(row.rightClaimIndex,row.right)) {gap('核心跨命题对照缺项、重复、对象回显或引句无效，尚不能确认整体关系。');return;}
  const valid=row.relation==='conflicts'||row.relation==='compatible'?row.sameObject&&row.sameFactDimension&&row.sameConditions
   :row.relation==='different_scope'?!row.sameObject||!row.sameConditions
   :row.relation==='different_dimension'?row.sameObject&&!row.sameFactDimension
   :row.relation==='cumulative'?row.sameObject:false;
  if(!valid){gap('核心跨命题对照未确认对象、事实维度与适用条件的关系，未猜测冲突。');return;}
  accepted.push(row);
 }
 const proposed=structuredClone(judgement.claims),conflicts:NonNullable<Judgement['conflicts']>=[];
 for(const row of accepted)if(row.relation==='conflicts') {
  const left=proposed[row.leftClaimIndex]!,right=proposed[row.rightClaimIndex]!;
  const leftEvidence=material.evidence[row.left.evidenceIndex]!,rightEvidence=material.evidence[row.right.evidenceIndex]!;
  const description='同范围命题存在未解决冲突：'+row.reason;
  // The independent audit has checked the opposing adopted conclusions. For a
  // refuted proposition its counter-evidence supports the original proposition.
  const leftRelation=judgement.claims[row.leftClaimIndex]!.status==='refuted'?'supports' as const:'contradicts' as const;
  const rightRelation=judgement.claims[row.rightClaimIndex]!.status==='refuted'?'supports' as const:'contradicts' as const;
  for(const [claim,evidence,relation] of [[left,rightEvidence,leftRelation],[right,leftEvidence,rightRelation]] as const) {
   if(!claim.links.some(link=>link.evidenceId===evidence.id&&link.relation===relation))claim.links.push({evidenceId:evidence.id,relation,rationale:'跨命题独审确认同范围互斥：'+row.reason.slice(0,970)});
   claim.status='mixed';claim.gaps=unique([...claim.gaps,description]);
  }
  conflicts.push({description,claimIds:[left.id,right.id],evidenceIds:unique([leftEvidence.id,rightEvidence.id])});
 }
 if(proposed.some(claim=>!ClaimSchema.safeParse(claim).success)){gap('核心跨命题冲突的完整引用关系留存容量不足，保留原命题并停止，不截断引用或继续调用。');return;}
 if(conflicts.length){judgement.claims=proposed;judgement.conflicts=conflicts;gap('核心跨命题冲突尚未解决，保留双方材料，不按来源数量或数值差异强选。',judgement.goalClaims.flatMap((indexes,goal)=>accepted.some(row=>row.relation==='conflicts'&&indexes.includes(row.leftClaimIndex)&&indexes.includes(row.rightClaimIndex))?[goal]:[]));}
}

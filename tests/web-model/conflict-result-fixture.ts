import type { ResultPayload } from '../../src/shared/contracts.js';
import { samplePayload } from '../helpers/result.js';

// Hand-written controlled_fixture, never a real investigation finding.
export function conflictPayload(origin='https://example.invalid'):ResultPayload{
 const p=samplePayload(),source=p.sources[0]!,evidence=p.evidence[0]!,claim=p.claims[0]!;
 const sourceIds=[source.id,'00000000-0000-4000-8000-000000000031'],evidenceIds=[evidence.id,'00000000-0000-4000-8000-000000000032'],claimIds=[claim.id,'00000000-0000-4000-8000-000000000033'];
 const conditions=['controlled_fixture：仅适用于2026届本科生的同一活动、同一报名渠道'];
 const unresolved='controlled_fixture：同届同人群截止日互斥，尚未找到更正或替代说明，冲突未解决，不能确定最终截止日。';
 return {...p,scope:{...p.scope,claimsToCheck:['报名截止2026年10月30日','报名截止2026年10月31日']},summary:'controlled_fixture：两份公告截止日存在未解决冲突，尚不能确定最终日期。',conditions,unknowns:[unresolved],nextSteps:['controlled_fixture：核对主办方更正公告'],stopReason:'no_useful_direction',
  sources:['a','b'].map((side,i)=>({...source,id:sourceIds[i]!,url:`${origin}/controlled-fixture/notice-${side}`,canonicalUrl:`${origin}/controlled-fixture/notice-${side}`,title:`controlled_fixture 公告${side.toUpperCase()}`,publisher:'controlled_fixture 主办方',originGroup:`controlled_fixture_${side}`})),
  evidence:[30,31].map((day,i)=>({...evidence,id:evidenceIds[i]!,origin:{kind:'source',id:sourceIds[i]!},excerpt:`controlled_fixture：2026届本科生报名截止2026年10月${day}日。`,limitations:['controlled_fixture：尚未找到公告替代关系']})),
  claims:[30,31].map((day,i)=>({...claim,id:claimIds[i]!,statement:`报名截止2026年10月${day}日`,conditions,status:'mixed',reasonSummary:unresolved,gaps:[unresolved],links:evidenceIds.map((id,j)=>({evidenceId:id,relation:i===j?'supports':'contradicts',rationale:'controlled_fixture：相同适用条件下两个互斥截止日'}))})),
  conflicts:[{description:unresolved,claimIds,evidenceIds}],answerBlocks:[{id:'conflict',text:unresolved,claimIds,evidenceIds}]};
}

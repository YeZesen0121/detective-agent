import type {Claim,ResultPayload} from '../../shared/contracts.js';

// Exact program-owned invalidation state, never a scan of model-authored reason text.
export const claimIsolationGap='原引用来源未核验、范围不对应或存在关键条件遗漏风险，原结论待重新核对。';
export const candidateIsolationGap='候选所引来源未核验、范围不对应或存在关键条件遗漏风险，身份与线索需重新核对。';
export const isolatedClaimReason='当前原引用尚未通过范围与上下文核验，原结论待重新核对；旧肯定理由不再采纳。';
export const isolatedCandidateReason='当前候选身份与线索仍待核验；旧匹配判断不再采纳，不能据此确认名称。';
export const hasClaimIsolation=(claim:Claim)=>claim.gaps.includes(claimIsolationGap);
export const hasCandidateIsolation=(candidate:ResultPayload['candidates'][number])=>candidate.missingClues.includes(candidateIsolationGap);

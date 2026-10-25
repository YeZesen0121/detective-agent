import { describe, expect, it } from 'vitest';
import { samplePayload } from '../helpers/result.js';
import { outcomeCopy, outcomeFor } from '../../src/web/ui/result-status.js';

describe('result presentation keeps operational outcomes distinct from truth judgments', () => {
  it('separates empty, partial, budget limit and provider failure', () => {
    const base = samplePayload();
    expect(outcomeFor({ ...base, sources: [], evidence: [], claims: [], stopReason: 'no_useful_direction' })).toBe('empty');
    expect(outcomeFor({ ...base, stopReason: 'no_useful_direction' })).toBe('partial');
    expect(outcomeFor({ ...base, stopReason: 'provider_error' })).toBe('partial');
    expect(outcomeFor({ ...base, stopReason: 'search_limit' })).toBe('limit');
    expect(outcomeFor({ ...base, sources: [], evidence: [], claims: [], stopReason: 'provider_error' })).toBe('failed');
    expect(outcomeCopy('limit').note).toContain('上限');
    expect(outcomeCopy('failed').note).toContain('未完成');
    for (const state of ['empty', 'partial', 'limit', 'failed'] as const) {
      expect(outcomeCopy(state).stamp).not.toBe('不成立');
    }
  });

  it('controlled_fixture distinguishes missing user clues from exhausted directions, conflicts and technical stops',()=>{
    const base=samplePayload();
    const copy=(stopReason:typeof base.stopReason)=>outcomeCopy('partial',{...base,stopReason});
    expect(copy('needs_user').note).toContain('需要你补充');
    expect(copy('no_useful_direction').note).toContain('有效的后续核验方向');
    expect(copy('provider_error').note).toContain('外部服务或网络');
    expect(copy('invalid_output').note).toContain('未通过核验');
    expect(copy('server_restart').note).toContain('服务中断');
    base.claims[0]!.status='insufficient';base.claims[0]!.links=[];
    expect(outcomeCopy('normal',base).stamp).not.toBe('已查');
    base.claims=[];base.evidence=[];base.answerBlocks=[];
    expect(outcomeCopy('normal',base).stamp).not.toBe('已查');
  });
});

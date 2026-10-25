import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {EvidenceLinkSchema} from '../../src/shared/contracts.js';
it('keeps a verified quote on the public link and preserves older links byte-for-byte',()=>{
 const legacy={evidenceId:randomUUID(),relation:'supports' as const,rationale:'controlled_fixture supported by source'};
 expect(EvidenceLinkSchema.parse(legacy)).toEqual(legacy);
 expect(EvidenceLinkSchema.parse({...legacy,quote:'受控原文：仅限本科生。'})).toEqual({...legacy,quote:'受控原文：仅限本科生。'});
 expect(EvidenceLinkSchema.safeParse({...legacy,quote:''}).success).toBe(false);
});

import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {companionCase,controlledModel} from './companion-fixture.js';
import {buildCompanion} from '../../src/server/companion/build.js';
it('reads one main conclusion and one quote, leaving verbose report detail on bound cards',async()=>{
 const f=companionCase(),p=f.input.version.payload;
 p.summary='整份摘要。'.repeat(40); f.claim.reasonSummary='整份理由mixed。'.repeat(25);
 const e=p.evidence[0]!;e.excerpt=Array.from({length:7},(_,i)=>`第${i}条完整原句，不表示延期。`).join('');
 f.claim.links=Array.from({length:7},(_,i)=>({...f.claim.links[0]!,quote:`第${i}条完整原句，不表示延期。`}));
 p.claims.push({...structuredClone(f.claim),id:randomUUID(),statement:'第二条完整命题不应再次朗读'});
 p.unknowns.push('核心目标未覆盖[0]：是否延期');
 const d=await buildCompanion(f.input,controlledModel(f.draft).services,new AbortController().signal),text=d.segments.map(s=>s.text).join('\n');
 expect(text).not.toContain(p.summary);expect(text).not.toContain(f.claim.reasonSummary);expect(text).not.toContain('第二条完整命题不应再次朗读');
 expect(text.match(/原材料引文/g)).toHaveLength(1);expect(text).not.toContain('核心目标未覆盖');expect(text).toContain('仍未回答的问题：是否延期');
 expect(d.segments.length).toBeLessThanOrEqual(5);expect(d.segments.every(s=>s.text.length<=400)).toBe(true);
 for(const value of [...p.conditions,...f.claim.conditions,...f.claim.gaps,p.queryTime])expect(text).toContain(value);
 expect(d.segments[1]!.evidenceIds).toContain(e.id);expect(d.segments[1]!.claimIds).toContain(p.claims[1]!.id);
});
it('selects the displayed claim evidence rather than an earlier answer-block-only quote',async()=>{
 const f=companionCase(),p=f.input.version.payload,original=p.evidence[0]!;
 const unrelated={...structuredClone(original),id:randomUUID(),excerpt:'食堂通知：周末营业。'};
 p.evidence.unshift(unrelated);p.answerBlocks=[{id:'background',text:'其他背景',claimIds:[],evidenceIds:[unrelated.id]}];
 const d=await buildCompanion(f.input,controlledModel(f.draft).services,new AbortController().signal);
 expect(d.segments.map(s=>s.text).join('\n')).not.toContain(unrelated.excerpt);
 expect(d.segments.map(s=>s.text).join('\n')).toContain(original.excerpt);
});

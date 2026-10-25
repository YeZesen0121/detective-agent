import {expect,it} from 'vitest';
import {clarificationFieldLabels,canRecheckOriginalDescription} from '../../src/web/model/clarification-labels.js';

it('projects clarification fields into fixed Chinese labels',()=>{
 expect(clarificationFieldLabels(['objectText','knownClues','groundedScope','year'])).toEqual(['对象描述','识别线索','范围与原文对应','年份']);
});
it('original-description recheck is restricted to object/scope fields only',()=>{
 expect(canRecheckOriginalDescription(['objectText','groundedScope'])).toBe(true);
 for(const fields of [[],['attachmentCriticalText'],['objectText','timeBudget'],['groundedScope','inputScope'],['futureKey']])expect(canRecheckOriginalDescription(fields)).toBe(false);
});
it('unknown and object-prototype keys never leak internal field names',()=>{
 expect(clarificationFieldLabels(['privateFutureKey','constructor','__proto__'])).toEqual(['必要信息']);expect(clarificationFieldLabels([])).toEqual([]);
});

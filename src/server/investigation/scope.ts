import { PreparationInputSchema, PreparationOutcomeSchema, type PreparationInput, type PreparationOutcome, type InvestigationServices } from '../../shared/ports.js';
import { groundedPreparation, scopeClarification } from './scope-grounding.js';
import { prepareSavedFollowup } from './followup-scope.js';

function concrete(text: string): boolean {
  if (/^(不知道|不确定|未知|没有|不记得|不知道叫什么|unknown|i don't know)[。！!？?\s]*$/i.test(text)) return false;
  const direct=text.replace(/^(?:请问|请|帮我|我想|核对|查一下|查询|关于|了解)+\s*/g,'');
  if (/^(?:这个|那个|这项|那项|该|上述|某个|某项)(?:活动|比赛|通知|消息|事情|说法|项目|产品|事件)?/.test(direct) && !/[《「“][^》」”]{2,}[》」”]|\b[A-Za-z][A-Za-z0-9.\-]{2,}\b/.test(text)) return false;
  const residue = text.replace(/这个|那个|这件事|这个活动|那个活动|这项活动|活动|事情|报名|截止|明天|今天|昨天|是否|真的|假的|是真的吗|是真的吗|是什么|怎么回事|帮我|查一下|核对|请问|到底|消息|通知|说法|真|假|是|吗|的|了|还|在|有|没|什么|哪[个项]?/g, '').replace(/[\p{P}\p{Z}\s]/gu, '');
  return residue.length >= 2;
}
export async function prepareInvestigation(input: PreparationInput, services: InvestigationServices, signal: AbortSignal): Promise<PreparationOutcome> {
  const p = PreparationInputSchema.parse(input); signal.throwIfAborted();
  const answer = p.clarificationAnswer?.answer?.trim();
  if(p.previousScope&&p.previousScope.basicMode!==p.basicMode)throw Error('SCOPE_MODE_MISMATCH');
  if(p.followup&&p.basicMode==='identify')return prepareSavedFollowup(p,services,signal);
  if(p.previousScope&&!answer)return PreparationOutcomeSchema.parse({scope:p.previousScope,clarification:null,canInvestigate:true});
  if(!p.previousScope&&!p.attachments.length&&!concrete(p.originalQuestion)&&!(answer&&concrete(answer)))return scopeClarification(p,'请提供要核对的活动、产品或事件名称，或能定位它的原文线索。');
  return groundedPreparation(p,services,signal);
}

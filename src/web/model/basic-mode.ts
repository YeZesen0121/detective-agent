import type { RuntimeCapabilities } from '../../shared/capabilities-http.js';
import type { BasicMode,PresentationMode } from '../../shared/contracts.js';
export const basicModeOptions:Array<{id:BasicMode;label:string;description:string}>=[{id:'truth',label:'查真假',description:'这句话有出处吗，站不站得住'},{id:'latest',label:'查最新',description:'截至现在，最新的说法是什么'},{id:'identify',label:'查模糊',description:'记不清是哪一个，帮我分开'}];
export function defaultBasicMode(capabilities:Pick<RuntimeCapabilities,'basicModes'>):BasicMode{return capabilities.basicModes.includes('truth')?'truth':capabilities.basicModes[0]??'truth';}
export function canSelectBasicMode(mode:BasicMode,capabilities:Pick<RuntimeCapabilities,'basicModes'>|null){return!!capabilities&&(capabilities.basicModes.includes(mode)||(mode==='truth'&&capabilities.basicModes.length===0));}
type DraftInput={originalQuestion:string;basicMode:BasicMode;presentationMode:PresentationMode};
export function draftInputMatches(saved:DraftInput,input:DraftInput){return saved.originalQuestion===input.originalQuestion.trim()&&saved.basicMode===input.basicMode&&saved.presentationMode===input.presentationMode;}

export function canStartNewInvestigation(capabilities:RuntimeCapabilities|null){return!!capabilities&&capabilities.newInvestigations?.available!==false;}

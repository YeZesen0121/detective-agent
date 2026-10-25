import type Database from 'better-sqlite3';
import type {RuntimeCapabilities} from '../../shared/capabilities-http.js';
import {PaidCampaign} from './paid-campaign.js';
import {BudgetBook} from './budget.js';
export function newInvestigationAvailability(db:Database.Database,configured:boolean,now:string):NonNullable<RuntimeCapabilities['newInvestigations']>{
 if(!configured)return{available:false,reason:'unconfigured',message:'当前尚未配置调查服务，可以保留草稿。'};
 if(new BudgetBook(db).unrestricted)return{available:true,reason:null,message:null};
 const state=new PaidCampaign(db).inspect();
 if(!state)return{available:true,reason:null,message:null};
 if(state.paused)return{available:false,reason:'paused',message:'当前服务的调用核对尚未完成，暂不能开查；已有报告仍可查看。'};
 if(Date.parse(now)>=Date.parse(state.policy.expiresAt))return{available:false,reason:'expired',message:'当前服务的调用授权已到期，暂不能开查；已有报告仍可查看。'};
 if(state.remainingRequests===0)return{available:false,reason:'request_limit',message:'当前服务的总调用次数已用完，暂不能开查；已有报告仍可查看。'};
 if(state.remainingMicros===0)return{available:false,reason:'cost_limit',message:'当前服务的调用金额已到上限，暂不能开查；已有报告仍可查看。'};
 if(state.operations.model>=state.policy.operationLimits.model)return{available:false,reason:'model_limit',message:'当前服务的模型调用额度已用完，暂不能开查；已有报告仍可查看。'};
 return{available:true,reason:null,message:null};
}

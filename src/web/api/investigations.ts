import { InvestigationsPageSchema,ListInvestigationsQuerySchema,type InvestigationsPage,DeleteInvestigationResponseSchema,type DeleteInvestigationResponse } from '../../shared/investigations-http.js';
import { IdSchema } from '../../shared/contracts.js';
import { ClientError,parseInput,request } from './client.js';

export interface InvestigationsApi{list(before:string|null,signal:AbortSignal):Promise<InvestigationsPage>;remove(id:string,signal:AbortSignal):Promise<DeleteInvestigationResponse>}
export function createInvestigationsApi(transport:typeof fetch):InvestigationsApi{
 return{async remove(id,signal){const value=parseInput(IdSchema,id),result=await request(`/api/v1/investigations/${value}`,{method:'DELETE',signal},DeleteInvestigationResponseSchema,transport);if(result.investigationId!==value)throw new ClientError('PROTOCOL_ERROR','删除响应与所选案卷不一致，请刷新历史核对。');return result;},list(before,signal){const input=parseInput(ListInvestigationsQuerySchema,{limit:20,...(before?{before}:{})}),query=new URLSearchParams({limit:String(input.limit)});if(input.before)query.set('before',input.before);return request(`/api/v1/investigations?${query}`,{signal},InvestigationsPageSchema,transport);}};
}

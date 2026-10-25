import { RuntimeCapabilitiesSchema } from '../../shared/capabilities-http.js';
import { request } from './client.js';
export function createCapabilitiesApi(transport:typeof fetch){return{get:(signal:AbortSignal)=>request('/api/v1/capabilities',{method:'GET',signal},RuntimeCapabilitiesSchema,transport)};}
export type CapabilitiesApi=ReturnType<typeof createCapabilitiesApi>;

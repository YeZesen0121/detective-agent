import { z } from 'zod';
import type { AccessGroup, BudgetAmounts, CompanionSession, InvocationContext, ResultVersion } from '../../shared/contracts.js';
import type { ExperienceModule, ModelRequest, ModelResponse, SpeechInput, TTSRequest, TTSResponse } from '../../shared/ports.js';
import type { CallSpec } from './gateway.js';
import type { RuntimeFunding } from './runtime-funding.js';
export type ResolvedImage={id:string;mime:'image/png'|'image/jpeg'|'image/webp';width:number;height:number;bytes:Buffer};
export type ImageMetadata=Omit<ResolvedImage,'bytes'>;
export const SpeechVoiceBindingSchema=z.strictObject({id:z.string().trim().min(1).max(128),provider:z.literal('tencent-tts'),voiceType:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),revision:z.string().trim().min(1).max(128),available:z.literal(true)});
export type SpeechVoiceBinding=z.infer<typeof SpeechVoiceBindingSchema>;
export type AuthorizedSpeechBinding={ownerSessionId:string;accessGroup:AccessGroup;version:ResultVersion;companion:CompanionSession;voice:SpeechVoiceBinding};
export type SpeechAuthorizationResolver=(input:SpeechInput,signal:AbortSignal)=>Promise<AuthorizedSpeechBinding>;
export interface ExperiencePricing {
 quote(operation:'model'|'tts',input:ModelRequest|TTSRequest,images?:ImageMetadata[]):Omit<CallSpec,'operation'>;
 actual(operation:'model'|'tts',response:ModelResponse|TTSResponse):BudgetAmounts|null;
 /** Required for any vision send, reviewed against the configured provider's image accounting. */
 visionInputTokens?(images:ImageMetadata[]):number;
}
export interface ExperienceRuntimeOptions {
 module:Pick<ExperienceModule,'extractAttachments'|'buildCompanion'|'answerCompanion'>&Partial<Pick<ExperienceModule,'synthesizeSegment'>>;
 providers:{model(input:ModelRequest,ctx:InvocationContext,signal:AbortSignal,images?:ResolvedImage[]):Promise<ModelResponse>;tts?(input:TTSRequest,ctx:InvocationContext,signal:AbortSignal):Promise<TTSResponse>};
 pricing:ExperiencePricing;funding:RuntimeFunding;
 voices?:Array<{id:string;label:string;available:boolean}>;ttsProviderVersion?:string;splitVersion?:string;
 /** Server-only voice identities; never accepted from HTTP or exposed by VoicesSchema. */
 speechVoices?:SpeechVoiceBinding[];
 /** Composes E's factory with P's durable authorization; no second queue or storage. */
 createSpeechSynthesizer?:(resolveAuthorized:SpeechAuthorizationResolver)=>ExperienceModule['synthesizeSegment'];
}

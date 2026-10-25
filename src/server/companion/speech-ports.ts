import type { AudioManifest, CompanionSession, ResultVersion, AccessGroup } from '../../shared/contracts.js';
import type { SpeechInput } from '../../shared/ports.js';
import type { SpeechPlan, SpeechChunkAudio } from './speech.js';
import { z } from 'zod';
import { AccessGroupSchema, CompanionSessionSchema, IdSchema, ResultVersionSchema } from '../../shared/contracts.js';

/** Private server binding resolved by P from authorized saved records, never accepted from HTTP JSON. */
export interface SpeechVoice {
  id: string; provider: 'tencent-tts'; voiceType: number; revision: string; available: true;
}
export interface SpeechBinding {
  ownerSessionId: string; accessGroup: AccessGroup; version: ResultVersion; companion: CompanionSession; voice: SpeechVoice;
}
export const SpeechVoiceSchema = z.strictObject({ id: z.string().trim().min(1).max(128), provider: z.literal('tencent-tts'),
  voiceType: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), revision: z.string().trim().min(1).max(128), available: z.literal(true) });
export const SpeechBindingSchema = z.strictObject({ ownerSessionId: IdSchema, accessGroup: AccessGroupSchema,
  version: ResultVersionSchema, companion: CompanionSessionSchema, voice: SpeechVoiceSchema });
export interface SpeechLease { jobId: string; epoch: number }
export interface SavedSpeechChunk {
  index: number; textHash: string; assetId: string; audioHash: string; byteLength: number; contentType: 'audio/mpeg';
}

/** Proposal only: P must implement durable owner/epoch checks and atomic cache single-flight. */
export interface SpeechPersistenceProposal {
  resolveAuthorized(input: SpeechInput, signal: AbortSignal): Promise<SpeechBinding>;
  acquire(plan: SpeechPlan, signal: AbortSignal): Promise<SpeechLease & { cachedChunks: SavedSpeechChunk[] }>;
  saveChunk(lease: SpeechLease, chunk: SpeechChunkAudio, signal: AbortSignal): Promise<SavedSpeechChunk>;
  finalize(lease: SpeechLease, status: 'ready' | 'partial' | 'failed' | 'cancelled', error: string | null): Promise<AudioManifest>;
}

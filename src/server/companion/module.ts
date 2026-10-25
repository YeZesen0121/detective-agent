import type { ExperienceModule } from '../../shared/ports.js';
import { extractAttachments } from '../attachments/extract.js';
import { buildCompanion } from './build.js';
import { answerCompanion } from './turn.js';
import { createSpeechSynthesizer, type ResolveAuthorizedSpeech } from './speech-persistent.js';

// A composable text subset, not a completed ExperienceModule with persistent TTS.
export const experienceTextModule = { extractAttachments, buildCompanion, answerCompanion } satisfies
  Pick<ExperienceModule, 'extractAttachments' | 'buildCompanion' | 'answerCompanion'>;

/** P injects a real saved-record authorization resolver; no fixture binding is installed here. */
export function createExperienceModule(resolveAuthorized:ResolveAuthorizedSpeech):ExperienceModule{
  return {...experienceTextModule,synthesizeSegment:createSpeechSynthesizer(resolveAuthorized)};
}

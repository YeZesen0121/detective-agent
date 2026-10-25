import type { ExperienceRuntimeOptions } from './experience-ports.js';
import { z } from 'zod';
import { BudgetAmountsSchema } from '../../shared/contracts.js';
import { createLiveExperienceRuntime } from './experience-runtime.js';
export function experienceRuntimeFromEnvironment(env: Record<string, string | undefined>): ExperienceRuntimeOptions | undefined {
  try {
    const enabled = env.EXPERIENCE_RUNTIME_ENABLED ?? '0', speech = env.TTS_RUNTIME_ENABLED ?? '0';
    z.enum(['0', '1']).parse(enabled); z.enum(['0', '1']).parse(speech);
    if (enabled === '0') { if (speech === '1') throw Error('Speech requires experience runtime'); return undefined; }
    const funding = z.strictObject({ global: BudgetAmountsSchema, trial: BudgetAmountsSchema, demo: BudgetAmountsSchema }).parse(JSON.parse(env.RUNTIME_FUNDING_JSON ?? ''));
    return createLiveExperienceRuntime({ deepseekKey: env.DEEPSEEK_API_KEY ?? '', funding,
      ...(speech === '1' ? { tts: { secretId: env.TENCENT_SECRET_ID ?? '', secretKey: env.TENCENT_SECRET_KEY ?? '', voiceIds: (env.TTS_VOICE_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean),
        ...(env.TENCENT_TTS_REGION?.trim() ? { region: env.TENCENT_TTS_REGION.trim() } : {}) } } : {}) });
  } catch { throw Error('Experience runtime configuration invalid: check explicit funding, provider credentials and reviewed voice ids.'); }
}

import type { PaidCampaignPolicy } from './paid-campaign.js';
// User-authorized overnight boundary, not a quota inferred from provider balance.
export function paidCampaignFromEnvironment(env: Record<string, string | undefined>): PaidCampaignPolicy | undefined {
  if (!env.LIVE_CAMPAIGN_ENABLED || env.LIVE_CAMPAIGN_ENABLED === '0') return undefined;
  if (env.LIVE_CAMPAIGN_ENABLED !== '1') throw Error('LIVE_CAMPAIGN_ENABLED must be 0 or 1');
  return { id: 'overnight-20261025-01', moneyMicros: 100000000, requestLimit: 2000,
    // User explicitly approved 100 CNY / 2000 total after removing extra operation sublimits; no usage reset.
    operationLimits: { search: 2000, read: 2000, model: 2000, tts: 2000 }, expiresAt: '2026-10-25T07:00:00.000Z' };
}

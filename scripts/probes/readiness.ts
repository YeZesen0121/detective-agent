import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const providers = {
  yuanbao: ['YUANBAO_API_KEY'],
  model: ['DEEPSEEK_API_KEY'], vision: ['DEEPSEEK_API_KEY'], reader: ['DEEPSEEK_API_KEY'],
  tts: ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_TTS_REGION', 'TENCENT_TTS_VOICE_ID'],
};
if (process.argv.includes('--live')) {
  console.error('Live probes are not implemented in T02a. Configure a bounded gateway and the relevant T01 probe first.');
  process.exitCode = 1;
} else console.log(JSON.stringify({
  checkedAt: new Date().toISOString(), mode: 'configuration-only', networkCalls: 0, costMicros: 0,
  providers: Object.entries(providers).map(([provider, names]) => ({
    provider, configured: provider === 'yuanbao'
      ? Boolean(process.env.YUANBAO_API_KEY?.trim() || (process.env.TENCENT_SECRET_ID?.trim() && process.env.TENCENT_SECRET_KEY?.trim()))
      : names.every((name) => Boolean(process.env[name]?.trim())),
    missingVariableNames: provider === 'yuanbao'
      ? (process.env.YUANBAO_API_KEY?.trim() || (process.env.TENCENT_SECRET_ID?.trim() && process.env.TENCENT_SECRET_KEY?.trim()) ? [] : ['YUANBAO_API_KEY or TENCENT_SECRET_ID + TENCENT_SECRET_KEY'])
      : names.filter((name) => !process.env[name]?.trim()),
    liveProbe: 'NOT_RUN_BY_CONFIGURATION_CHECK', pricingAndLimits: 'PRODUCT_RUNTIME_NOT_CONFIGURED',
  })),
}, null, 2));

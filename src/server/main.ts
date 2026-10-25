import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { TimestampSchema } from '../shared/contracts.js';
import { buildApp } from './app.js';
import { truthRuntimeFromEnvironment } from './platform/truth-configuration.js';
import { experienceRuntimeFromEnvironment } from './platform/experience-configuration.js';
import { acquireRuntimeLock, createRuntimeShutdown } from './platform/runtime-lock.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = z.object({
  APP_ORIGIN: z.url(), PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('.local/detective.db'),
  TRIAL_ACCESS_CODE: z.string().min(12), DEMO_ACCESS_CODE: z.string().min(12), SERVICE_ENDS_AT: TimestampSchema,
}).safeParse(process.env);
if (!config.success) {
  console.error('Configuration missing or invalid:', config.error.issues.map((issue) => issue.path.join('.')).join(', '));
  process.exitCode = 1;
} else {
  const env = config.data;
  let investigationRuntime, experienceRuntime;
  try { investigationRuntime=truthRuntimeFromEnvironment(process.env); experienceRuntime=experienceRuntimeFromEnvironment(process.env);
    if(investigationRuntime&&experienceRuntime)investigationRuntime.supportsAttachments=!!experienceRuntime.pricing.visionInputTokens;
  }
  catch { console.error('Runtime configuration invalid. Check funding records and provider configuration.'); process.exit(1); }
  const webRoot = resolve('dist/web');
  let releaseRuntimeLock:()=>void;
  try{releaseRuntimeLock=acquireRuntimeLock(env.DATABASE_PATH);}
  catch{console.error('Runtime database is already owned or unavailable. Stop the existing host before starting another.');process.exit(1);}
  let app:ReturnType<typeof buildApp>;
  try{app = buildApp({
    databasePath: env.DATABASE_PATH, allowedOrigin: env.APP_ORIGIN,
    trialCode: env.TRIAL_ACCESS_CODE, demoCode: env.DEMO_ACCESS_CODE, serviceEndsAt: env.SERVICE_ENDS_AT,
    secureCookies: new URL(env.APP_ORIGIN).protocol === 'https:', unrestrictedUsage: true,
    ...(investigationRuntime ? {investigationRuntime} : {}),
    ...(experienceRuntime ? {experienceRuntime} : {}),
    ...(existsSync(resolve(webRoot, 'index.html')) ? { webRoot } : {}),
  });}catch{releaseRuntimeLock();console.error('Runtime storage initialization failed.');process.exit(1);}
  const close=createRuntimeShutdown(()=>app.close(),releaseRuntimeLock);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void close().catch(()=>{console.error('Runtime shutdown did not complete.');process.exitCode=1;});
  });
  try {
    await app.listen({ host: '127.0.0.1', port: env.PORT });
    console.log(`API listening on http://127.0.0.1:${env.PORT}; ${investigationRuntime?`investigation worker configured: ${investigationRuntime.supportedBasicModes?.join(',')}; followup=${investigationRuntime.enableFollowups===true}; watch=${investigationRuntime.enableWatches!==false}.`:'investigation runtime disabled.'}`);
  } catch {
    console.error('Foundation server could not start. Check port and configuration.');
    await close().catch(()=>{console.error('Runtime shutdown did not complete.');}); process.exitCode = 1;
  }
}

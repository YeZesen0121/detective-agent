import { buildApp } from '../src/server/app.js';

// Dedicated process, in-memory SQLite and controlled access codes. No providers.
const app = buildApp({
  databasePath: ':memory:', allowedOrigin: 'http://127.0.0.1:5173',
  trialCode: 'controlled-e2e-trial', demoCode: 'controlled-e2e-demo',
  serviceEndsAt: new Date(Date.now() + 86400000).toISOString(), secureCookies: false,
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port: 3000 });

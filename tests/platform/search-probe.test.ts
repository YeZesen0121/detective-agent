import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('accepts a Tencent signed credential pair in configuration-only mode without a Bearer key', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/probes/search.ts'], {
    encoding: 'utf8', env: { ...process.env, YUANBAO_API_KEY: '', TENCENT_SECRET_ID: 'controlled-id', TENCENT_SECRET_KEY: 'controlled-secret' },
  });
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ authMode: 'tc3-signature', endpoint: 'https://wsa.tencentcloudapi.com/', httpAttempts: 0, status: 'NOT_RUN' });
  expect(result.stdout).not.toContain('controlled-id');
  expect(result.stdout).not.toContain('controlled-secret');
});

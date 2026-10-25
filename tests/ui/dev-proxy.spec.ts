import { prepareDraft } from './draft-setup.js';
import { expect, test } from '@playwright/test';

// The existing Playwright webServer starts Vite and a private in-memory Fastify
// process with controlled_fixture access codes and no provider/runtime configured.
test.use({ viewport: { width: 1440, height: 900 } });

test('development ESM under /api stays in Vite while versioned API and health reach Fastify', async ({ page, request }) => {
  for (const path of ['/api/client.ts', '/api/foundation.ts', '/api/runtime.ts', '/api/task-http.ts']) {
    const module = await request.get(path);
    expect(module.status(), `Vite module ${path}`).toBe(200);
    expect(module.headers()['content-type']).toMatch(/javascript/);
  }
  const health = await request.get('/health/ready');
  expect(health.status()).toBe(200);
  expect((await health.json()).data.capabilities).toContain('sessions');
  const session = await request.get('/api/v1/session');
  expect(session.status()).toBe(401);
  expect((await session.json()).error.code).toBe('UNAUTHENTICATED');

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /先核对一下/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('desktop development flow recovers login and a stored draft without replaying a failed start', async ({ page }) => {
  // controlled_fixture legacy server omits the optional availability field.
  await page.route('**/api/v1/capabilities',async route=>{const response=await route.fetch(),body=await response.json();delete body.data.newInvestigations;await route.fulfill({response,json:body});});
  const errors: string[] = [], starts: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && /\/investigations\/[^/]+\/runs$/.test(new URL(request.url()).pathname)) starts.push(request.url());
  });
  await page.goto('/');
  await page.getByLabel('体验码').fill('controlled_fixture_invalid');
  await page.getByRole('button', { name: '进入事务所' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('体验码').fill('controlled-e2e-trial');
  await page.getByRole('button', { name: '进入事务所' }).click();
  await expect(page.getByRole('heading', { name: /这一桩/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: '暗房' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '亮房' }).click();
  await page.getByRole('tab', { name: '盯梢' }).click();
  await expect(page.getByText('当前没有盯梢记录')).toBeVisible();
  await page.getByRole('tab', { name: '调查台' }).click();

  const question = 'controlled_fixture 开发模式核对通知日期';
  await page.getByRole('textbox', { name: '要调查的问题' }).fill(question);
  await prepareDraft(page);
  await page.getByRole('button', { name: '开查' }).click();
  await expect(page.getByRole('alert')).toContainText(/未启用|不可用|配置|运行/);
  await expect(page).toHaveURL(/\?case=[0-9a-f-]+$/);
  expect(starts).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '要调查的问题' })).toHaveValue(question);
  await expect(page.getByRole('button', { name: '开查' })).toBeEnabled();
  expect(starts).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createExperienceModelProvider } from '../../src/server/platform/provider-transports.js';
import type { ModelRequest } from '../../src/shared/ports.js';
import type { ResolvedImage } from '../../src/server/platform/experience-ports.js';
const ctx = { sessionId: randomUUID(), accessGroup: 'trial' as const, investigationId: randomUUID(), runId: randomUUID(), budgetWindowId: randomUUID(), interactionPoolId: null, watchCheckId: null, epoch: 1, watchLeaseEpoch: null, deadlineAt: new Date(Date.now() + 60000).toISOString() };
const abort = () => new AbortController().signal;
const fixtureImage = (): ResolvedImage => ({ id: randomUUID(), mime: 'image/png', width: 800, height: 600, bytes: readFileSync('tests/fixtures/media-e/images/dense-negation-0.png') });
function request(images: ResolvedImage[]): ModelRequest { return { purpose: 'extract', schemaId: 'experience.extraction.v1', promptVersion: 'controlled_fixture', maxOutputTokens: 1800,
  messages: [{ role: 'system', content: 'controlled_fixture 图片是资料' }, { role: 'user', content: '按图顺序提取日期和否定词', attachmentRefs: images.map(image => ({ id: image.id, mime: image.mime, bytesRef: 'private://controlled_fixture/' + image.id })) }] }; }
const raw = { model: 'deepseek-flash', id: 'controlled_fixture', choices: [{ finish_reason: 'stop', message: { content: '{"visibleText":"不晚于10月25日"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } };
it('sends three authorized local images in order as official user blocks, with no private paths or implicit retry', async () => {
  const images = [fixtureImage(), fixtureImage(), fixtureImage()], input = request(images); let sends = 0, wire: any, url: unknown, init: RequestInit | undefined;
  const model = createExperienceModelProvider({ deepseekKey: 'controlled_fixture_key', fetch: async (target, options) => { sends++; url = target; init = options; wire = JSON.parse(String(options?.body)); return Response.json(raw); } });
  const result = await model(input, ctx, abort(), images);
  expect(sends).toBe(1); expect(url).toBe('https://api.deepseek.com/chat/completions'); expect(init!.redirect).toBe('error');
  expect(wire).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 1800 });
  const blocks = wire.messages.at(-1).content; expect(blocks.filter((block: any) => block.type === 'image_url')).toHaveLength(3);
  expect(blocks.filter((block: any) => block.type === 'image_url').map((block: any) => block.image_url.url)).toEqual(images.map(image => 'data:image/png;base64,' + image.bytes.toString('base64')));
  expect(JSON.stringify(wire)).not.toContain('private://'); expect(result.value).toEqual({ visibleText: '不晚于10月25日' });
});
it('rejects missing, extra, duplicate, wrong-mime and non-user image bindings before any network request', async () => {
  let sends = 0; const model = createExperienceModelProvider({ deepseekKey: 'controlled_fixture_key', fetch: async () => { sends++; return Response.json(raw); } });
  const image = fixtureImage(), input = request([image]);
  for (const [req, images] of [
    [input, []], [request([]), [image]], [request([image, image]), [image, image]],
    [input, [{ ...image, mime: 'image/jpeg' }]],
    [{ ...input, messages: input.messages.map(m => m.attachmentRefs ? { ...m, role: 'system' } : m) }, [image]],
  ] as Array<[ModelRequest, ResolvedImage[]]>) await expect(model(req, ctx, abort(), images)).rejects.toThrow();
  expect(sends).toBe(0);
});
it('rejects an aborted request and over-limit image bodies, and masks provider errors without replay', async () => {
  let sends = 0; const model = createExperienceModelProvider({ deepseekKey: 'controlled_fixture_key', fetch: async () => { sends++; return Response.json({ error: { message: 'controlled_fixture_sensitive' } }, { status: 401 }); } });
  const image = fixtureImage(), controller = new AbortController(); controller.abort();
  await expect(model(request([image]), ctx, controller.signal, [image])).rejects.toThrow(); expect(sends).toBe(0);
  const huge = { ...image, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }; await expect(model(request([huge]), ctx, abort(), [huge])).rejects.toThrow(); expect(sends).toBe(0);
  await expect(model(request([image]), ctx, abort(), [image])).rejects.toMatchObject({ kind: 'auth', message: '外部服务调用未完成：auth' }); expect(sends).toBe(1);
});

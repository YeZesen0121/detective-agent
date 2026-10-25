// Explicit offline authoring command only: npx --no-install tsx tests/fixtures/media-e/generate.ts
// No provider, network, user media or environment credential access.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createMediaScenario, MEDIA_SCENARIO_IDS } from './scenarios.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
await mkdir(new URL('images/', import.meta.url), { recursive: true });
await mkdir(new URL('audio/', import.meta.url), { recursive: true });
const images = [];
for (const caseId of MEDIA_SCENARIO_IDS) {
  const f = createMediaScenario(caseId); if (f.kind !== 'extraction') continue;
  for (const entry of f.images) {
    const characters = Array.from(entry.text), lines: string[] = [];
    while (characters.length) lines.push(characters.splice(0, 26).join(''));
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="400"><rect width="960" height="400" fill="#f4f1e8"/><g font-family="Microsoft YaHei, sans-serif" fill="#1c2430"><text x="32" y="45" font-size="20">controlled_fixture / ${caseId}</text>${lines.map((line, n) => `<text x="32" y="${100 + 46 * n}" font-size="28">${escape(line)}</text>`).join('')}<text x="32" y="365" font-size="20">自有虚构测试材料；图中文字是待查说法。</text></g></svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFile(new URL(entry.path, import.meta.url), bytes);
    images.push({ caseId, attachmentId: entry.attachmentId, path: entry.path, sha256: hash(bytes), extractedTextSha256: hash(entry.text), width: 960, height: 400 });
  }
}
const audioPath = fileURLToPath(new URL('audio/offline-tone.mp3', import.meta.url));
const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=24000:duration=0.6',
  '-af', 'afade=t=in:st=0:d=0.03,afade=t=out:st=0.5:d=0.1', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', '-y', audioPath];
run('ffmpeg', args);
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,sample_rate,channels', '-of', 'json', audioPath]));
// Full frame decode, not a signature sniff or extension check.
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', audioPath, '-f', 'null', '-']);
const bytes = await readFile(audioPath);
const metadata = { classification: 'controlled_fixture', purpose: 'Owned synthetic tone, not speech or a TTS listening sample',
  imageAuthoring: 'Original fictional text rendered using sharp SVG and local Microsoft YaHei font; no external images',
  sharpVersions: sharp.versions, images,
  audio: { path: 'audio/offline-tone.mp3', sha256: hash(bytes), byteLength: bytes.length,
    generatedPcmSeconds: 0.6, contentType: 'audio/mpeg', probe, ffmpegVersion: run('ffmpeg', ['-version']).split('\n')[0],
    ffprobeVersion: run('ffprobe', ['-version']).split('\n')[0],
    generationArgs: args.map(v => v === audioPath ? 'tests/fixtures/media-e/audio/offline-tone.mp3' : v),
    fullDecode: { command: 'ffmpeg -hide_banner -loglevel error -xerror -i tests/fixtures/media-e/audio/offline-tone.mp3 -f null -', exitCode: 0 }, platform: process.platform } };
await writeFile(new URL('manifest.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
console.log(`Generated ${images.length} owned PNG fixtures and decoded one tone in ${root}`);
console.log(JSON.stringify(metadata.audio, null, 2));

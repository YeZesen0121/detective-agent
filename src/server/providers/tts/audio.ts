import { TTSResponseSchema, type TTSResponse } from '../../../shared/ports.js';
import { SpeechError } from '../../companion/speech-errors.js';

export const MAX_PRIVATE_AUDIO_BYTES = 4 * 1024 * 1024;
/** Container-signature check only, not a decoder or actual listening acceptance. */
export function checkedPrivateAudio(value: unknown): TTSResponse {
  const parsed = TTSResponseSchema.safeParse(value);
  if (!parsed.success) throw new SpeechError('SPEECH_INVALID_AUDIO', '语音服务没有返回有效的mp3音频。');
  const bytes = parsed.data.audioBytes;
  const frame = bytes.length >= 4 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  const id3 = bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  if (!bytes.length || bytes.length > MAX_PRIVATE_AUDIO_BYTES || (!frame && !id3)) throw new SpeechError('SPEECH_INVALID_AUDIO', '音频为空、超出单块上限或不是可识别的mp3数据。');
  return { ...parsed.data, audioBytes: new Uint8Array(bytes) };
}

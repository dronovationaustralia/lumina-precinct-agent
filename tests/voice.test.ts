/** /api/v1/transcribe input validation, without calling the network. */
import { describe, expect, test } from 'vitest';

import { MAX_AUDIO_BYTES, validateAudio } from '@/server/voice';

function clip(size: number, name = 'question.webm', type = 'audio/webm'): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('transcribe input validation', () => {
  test('rejects a missing file', () => {
    expect(validateAudio(null)).toEqual({
      ok: false,
      code: 'missing_audio',
      message: expect.stringContaining('No audio'),
    });
    expect(validateAudio(undefined)).toMatchObject({ ok: false, code: 'missing_audio' });
    expect(validateAudio('question.webm')).toMatchObject({ ok: false, code: 'missing_audio' });
  });

  test('rejects an empty file', () => {
    expect(validateAudio(clip(0))).toMatchObject({ ok: false, code: 'missing_audio' });
  });

  test('rejects a file over 10 MB', () => {
    expect(validateAudio(clip(MAX_AUDIO_BYTES + 1))).toEqual({
      ok: false,
      code: 'audio_too_large',
      message: expect.stringContaining('10 MB'),
    });
  });

  test('accepts a file exactly at the cap', () => {
    expect(validateAudio(clip(MAX_AUDIO_BYTES))).toMatchObject({ ok: true });
  });

  test('rejects an unsupported type', () => {
    expect(validateAudio(clip(100, 'notes.txt', 'text/plain'))).toMatchObject({
      ok: false,
      code: 'unsupported_audio_type',
    });
  });

  test.each([
    ['question.webm', 'audio/webm'],
    ['question.ogg', 'audio/ogg'],
    ['question.wav', 'audio/wav'],
    ['question.mp4', 'audio/mp4'],
  ])('accepts %s', (name, type) => {
    expect(validateAudio(clip(100, name, type))).toMatchObject({ ok: true });
  });

  test('accepts a recording with no MIME type when the extension is known', () => {
    expect(validateAudio(clip(100, 'question.webm', ''))).toMatchObject({ ok: true });
  });
});

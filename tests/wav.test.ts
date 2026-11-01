import { describe, expect, test } from 'vitest';

import { encodeWav } from '../src/components/portal/wav';
import { keywordsFor, TRANSCRIBE_KEYWORDS } from '../src/server/voice';

describe('voice upload format', () => {
  test('encodes mono 24 kHz 16-bit PCM WAV', async () => {
    const blob = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 24_000);
    const v = new DataView(await blob.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect(blob.type).toBe('audio/wav');
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10);
    expect(v.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(v.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
  });

  test('keyword hints stay short and add the selected station once', () => {
    expect(TRANSCRIBE_KEYWORDS.length).toBeLessThanOrEqual(15);
    expect(keywordsFor('Artarmon')).toContain('Artarmon');
    expect(keywordsFor('Chatswood').filter((k) => k === 'Chatswood')).toHaveLength(1);
    expect(keywordsFor('Not A Station')).toEqual([...TRANSCRIBE_KEYWORDS]);
  });
});

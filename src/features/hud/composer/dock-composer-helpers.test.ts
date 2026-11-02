import { describe, expect, it, vi } from 'vitest';
import { encodeWavPcm16, WAV_SAMPLE_RATE } from '$features/voice/utils/wav-encoder';
import type { DockMark } from '$shared/dock-evidence';
import {
  createDockSilenceDetector,
  dictationSpans,
  joinDictationSpans,
  transcribeDictationAtMarks,
} from './dock-dictation-segments';
import { differenceHash, dockScreenChanged, hashDistance } from './dock-evidence-hash';
import { layoutDockBurn } from './dock-evidence-render';

function gradient(width: number, height: number, invert = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(((invert ? width - x : x) / width) * 255);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  return { data, width, height };
}

describe('dock dictation at marks', () => {
  it('splits at click offsets, clamping and ordering clicks', () => {
    expect(
      dictationSpans(5000, [
        { markId: 'b', offsetMs: 3200 },
        { markId: 'a', offsetMs: 1200 },
        { markId: 'late', offsetMs: 9000 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 1200, markId: 'a' },
      { startMs: 1200, endMs: 3200, markId: 'b' },
      { startMs: 3200, endMs: 5000, markId: 'late' },
      { startMs: 5000, endMs: 5000 },
    ]);
  });

  it('places each chip where it was spoken with single-space seams', () => {
    const spans = dictationSpans(4000, [
      { markId: 'm1', offsetMs: 1000 },
      { markId: 'm2', offsetMs: 2000 },
    ]);
    expect(
      joinDictationSpans(spans, ['Closer, but this  ', ' still has the old shadow', '']),
    ).toEqual([
      { kind: 'text', text: 'Closer, but this ' },
      { kind: 'mark', markId: 'm1' },
      { kind: 'text', text: ' still has the old shadow ' },
      { kind: 'mark', markId: 'm2' },
    ]);
  });

  it('transcribes each span of one decoded recording in order', async () => {
    const seconds = 3;
    const wav = encodeWavPcm16(
      new Float32Array(WAV_SAMPLE_RATE * seconds).fill(0.25),
      WAV_SAMPLE_RATE,
    );
    const lengths: number[] = [];
    const transcribe = vi.fn(async (span: Blob) => {
      lengths.push(span.size);
      return ['this', 'drops its hover'][lengths.length - 1] ?? '';
    });
    const parts = await transcribeDictationAtMarks(
      new Blob(['recorded']),
      seconds * 1000,
      [{ markId: 'm1', offsetMs: 1000 }],
      { transcribe, decode: async () => wav },
    );
    expect(parts).toEqual([
      { kind: 'text', text: 'this ' },
      { kind: 'mark', markId: 'm1' },
      { kind: 'text', text: ' drops its hover' },
    ]);
    // 1 s and 2 s of 16 kHz PCM16 plus one 44-byte header each.
    expect(lengths).toEqual([44 + WAV_SAMPLE_RATE * 2, 44 + WAV_SAMPLE_RATE * 4]);
  });

  it('stops after sustained silence and restarts the window on voice', () => {
    const detector = createDockSilenceDetector(8000);
    expect(detector.feed(0.3, 0)).toBe(false);
    expect(detector.feed(0.01, 7999)).toBe(false);
    expect(detector.feed(0.5, 7999)).toBe(false);
    expect(detector.feed(0.01, 15_998)).toBe(false);
    expect(detector.feed(0.01, 15_999)).toBe(true);
  });
});

describe('dock screen change hash', () => {
  it('is stable for the same screen and exceeds the threshold for a changed one', () => {
    const before = differenceHash(gradient(320, 200));
    expect(before).toHaveLength(64);
    expect(hashDistance(before, differenceHash(gradient(320, 200)))).toBe(0);
    const after = differenceHash(gradient(320, 200, true));
    expect(dockScreenChanged(before, after)).toBe(true);
    expect(dockScreenChanged(undefined, after)).toBe(false);
    expect(hashDistance(before, 'short')).toBe(Infinity);
  });
});

describe('dock evidence burn layout', () => {
  const mark = (geometry: DockMark['geometry'], bounds: DockMark['bounds']): DockMark => ({
    id: 'm',
    imageId: 'a',
    tool: 'box',
    geometry,
    bounds,
    element: null,
    createdAt: 0,
  });

  it('scales geometry to the output and keeps every badge inside the image', () => {
    const image = { width: 2880, height: 1800, displayScale: 2 };
    const ops = layoutDockBurn(
      image,
      [
        {
          n: 1,
          mark: mark(
            { kind: 'rect', x: 1240, y: 912, w: 224, h: 72 },
            { x: 1240, y: 912, w: 224, h: 72 },
          ),
        },
        {
          n: 12,
          mark: mark(
            { kind: 'rect', x: 2800, y: 0, w: 80, h: 30 },
            { x: 2800, y: 0, w: 80, h: 30 },
          ),
        },
      ],
      0.5,
    );
    expect(ops[0]).toEqual({ kind: 'rect', x: 620, y: 456, w: 112, h: 36, width: 2 });
    const badges = ops.filter((op) => op.kind === 'badge');
    expect(badges.map((op) => op.label)).toEqual(['1', '12']);
    for (const badge of badges) {
      if (badge.kind !== 'badge') continue;
      expect(badge.x + badge.radius).toBeLessThanOrEqual(1440);
      expect(badge.y - badge.radius).toBeGreaterThanOrEqual(0);
    }
    // Small previews keep a legible numeral regardless of output scale.
    const tiny = { x: 0, y: 0, w: 10, h: 10 };
    const preview = layoutDockBurn(
      image,
      [{ n: 1, mark: mark({ kind: 'rect', ...tiny }, tiny) }],
      0.05,
      6,
    );
    expect(preview.find((op) => op.kind === 'badge')).toMatchObject({ radius: 6 });
  });
});

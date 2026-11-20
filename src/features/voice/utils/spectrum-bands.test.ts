import { describe, expect, it } from 'vitest';
import { DICTATION_BAR_COUNT, spectrumBands } from './spectrum-bands';

const SAMPLE_RATE = 48_000;
const BIN_COUNT = 512;
const binHz = SAMPLE_RATE / (2 * BIN_COUNT);

function bins(fill: (hz: number) => number, count = BIN_COUNT): Uint8Array {
  return Uint8Array.from({ length: count }, (_, index) => fill(index * binHz));
}

describe('spectrumBands', () => {
  it('returns one value per dictation bar', () => {
    expect(
      spectrumBands(
        bins(() => 128),
        SAMPLE_RATE,
      ),
    ).toHaveLength(DICTATION_BAR_COUNT);
  });

  it('keeps silence and the room-noise floor flat', () => {
    expect(
      spectrumBands(
        bins(() => 0),
        SAMPLE_RATE,
      ),
    ).toEqual([0, 0, 0, 0, 0]);
    expect(
      spectrumBands(
        bins(() => 30),
        SAMPLE_RATE,
      ),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it('saturates a full-scale signal at 1', () => {
    expect(
      spectrumBands(
        bins(() => 255),
        SAMPLE_RATE,
      ),
    ).toEqual([1, 1, 1, 1, 1]);
  });

  it('orders bands low to high frequency', () => {
    const low = spectrumBands(
      bins((hz) => (hz < 200 ? 240 : 0)),
      SAMPLE_RATE,
    );
    expect(low[0]).toBeGreaterThan(0.5);
    expect(low.slice(1)).toEqual([0, 0, 0, 0]);

    const high = spectrumBands(
      bins((hz) => (hz > 2_500 && hz < 4_000 ? 240 : 0)),
      SAMPLE_RATE,
    );
    expect(high[DICTATION_BAR_COUNT - 1]).toBeGreaterThan(0.5);
    expect(high[0]).toBe(0);
  });

  it('stays finite and in range for tiny or empty buffers', () => {
    for (const data of [new Uint8Array(0), bins(() => 200, 4), bins(() => 200, 16)]) {
      const bands = spectrumBands(data, SAMPLE_RATE);
      expect(bands).toHaveLength(DICTATION_BAR_COUNT);
      for (const value of bands) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

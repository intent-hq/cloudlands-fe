/** Bars in every live dictation meter (chat input, dock, hardware-key HUD). */
export const DICTATION_BAR_COUNT = 5;

/** Speech energy sits between these; log-spaced bands keep low voices from one bar. */
const MIN_HZ = 120;
const MAX_HZ = 4_000;
/** Byte magnitudes (0–255 over the analyser's dB range) mapped to an empty and a full bar. */
const FLOOR = 0.2;
const CEILING = 0.8;

/**
 * Collapse `AnalyserNode.getByteFrequencyData` bins into {@link DICTATION_BAR_COUNT}
 * normalized (0–1) bands, low to high frequency. Room noise below the floor reads 0.
 */
export function spectrumBands(
  bins: ArrayLike<number>,
  sampleRate: number,
  count = DICTATION_BAR_COUNT,
): number[] {
  const binHz = bins.length > 0 ? sampleRate / (2 * bins.length) : 0;
  const ratio = MAX_HZ / MIN_HZ;
  return Array.from({ length: count }, (_, band) => {
    if (binHz <= 0) return 0;
    const low = MIN_HZ * ratio ** (band / count);
    const high = MIN_HZ * ratio ** ((band + 1) / count);
    const start = Math.min(bins.length - 1, Math.floor(low / binHz));
    const end = Math.min(bins.length, Math.max(start + 1, Math.ceil(high / binHz)));
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += bins[index] ?? 0;
    const magnitude = sum / (end - start) / 255;
    const value = (magnitude - FLOOR) / (CEILING - FLOOR);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  });
}

import { describe, expect, it } from 'vitest';
import { formatHudClock, formatHudTimer } from './hud-format';

describe('formatHudTimer', () => {
  it('formats zero', () => {
    expect(formatHudTimer(0)).toBe('00:00:00');
  });

  it('formats h/m/s with zero padding', () => {
    expect(formatHudTimer(4262)).toBe('01:11:02');
    expect(formatHudTimer(59)).toBe('00:00:59');
    expect(formatHudTimer(3600)).toBe('01:00:00');
  });

  it('floors fractional seconds', () => {
    expect(formatHudTimer(61.9)).toBe('00:01:01');
  });

  it('exceeds two hour digits without wrapping', () => {
    expect(formatHudTimer(100 * 3600)).toBe('100:00:00');
  });

  it('clamps negative and non-finite input', () => {
    expect(formatHudTimer(-5)).toBe('00:00:00');
    expect(formatHudTimer(Number.NaN)).toBe('00:00:00');
  });
});

describe('formatHudClock', () => {
  it('renders zero-padded local 24h wall-clock', () => {
    const epoch = new Date(2026, 6, 30, 9, 5, 7).getTime();
    expect(formatHudClock(epoch)).toBe('09:05:07');
  });
});

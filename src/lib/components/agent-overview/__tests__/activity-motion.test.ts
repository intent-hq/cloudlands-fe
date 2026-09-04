import { describe, expect, it } from 'vitest';
import {
  edgeAnimationDuration,
  isRecentlyActive,
  messageParticleLimit,
  nodeEnterDelay,
  playbackDuration,
  resourceBrightness,
  resourceCooldownRemaining,
} from '../activity-motion';

describe('activity motion', () => {
  it('limits recent edge activity to the configured window', () => {
    const now = Date.parse('2026-09-04T00:00:10.000Z');
    expect(isRecentlyActive('2026-09-04T00:00:06.000Z', now)).toBe(true);
    expect(isRecentlyActive('2026-09-04T00:00:04.000Z', now)).toBe(false);
  });

  it('scales particle duration with edge length', () => {
    expect(edgeAnimationDuration({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(1);
    expect(edgeAnimationDuration({ x: 0, y: 0 }, { x: 150, y: 0 })).toBe(2);
    expect(edgeAnimationDuration({ x: 0, y: 0 }, { x: 150, y: 0 }, 4)).toBe(1);
  });

  it('compresses motion and caps particles during fast playback', () => {
    expect(playbackDuration(350, 1)).toBe(350);
    expect(playbackDuration(350, 8)).toBe(140);
    expect(nodeEnterDelay(3, 1)).toBe(120);
    expect(nodeEnterDelay(3, 4)).toBe(60);
    expect(messageParticleLimit(1)).toBe(8);
    expect(messageParticleLimit(4)).toBe(5);
    expect(messageParticleLimit(8)).toBe(3);
  });

  it('dims resources over ten minutes', () => {
    const touchedAt = '2026-09-04T00:00:00.000Z';
    const start = Date.parse(touchedAt);
    expect(resourceBrightness(touchedAt, start)).toBe(1);
    expect(resourceBrightness(touchedAt, start + 5 * 60 * 1000)).toBeCloseTo(0.675);
    expect(resourceBrightness(touchedAt, start + 10 * 60 * 1000)).toBe(0.35);
    expect(resourceCooldownRemaining(touchedAt, start + 5 * 60 * 1000)).toBe(5 * 60 * 1000);
  });
});

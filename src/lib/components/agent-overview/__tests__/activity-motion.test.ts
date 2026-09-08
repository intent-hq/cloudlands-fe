import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activityHullTransition,
  edgeAnimationDuration,
  isRecentlyActive,
  messageParticleLimit,
  nodeEnterDelay,
  playbackDuration,
  resourceBrightness,
  resourceCooldownRemaining,
} from '../activity-motion';

function useReducedMotion(reduced: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList);
}

afterEach(() => vi.restoreAllMocks());

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

  it('scales hulls in and out with playback-aware transition timing', () => {
    useReducedMotion(false);
    const element = document.createElement('div');

    const enter = activityHullTransition(element, { delay: 80, playbackSpeed: 4 });
    const exit = activityHullTransition(element, { exit: true });

    expect(enter.delay).toBe(80);
    expect(enter.duration).toBe(160);
    expect(enter.css?.(0, 1)).toContain('transform: scale(0.6)');
    expect(enter.css?.(1, 0)).toContain('transform: scale(1)');
    expect(enter.easing?.(0.5)).toBeGreaterThan(0.5);
    expect(exit.delay).toBe(0);
    expect(exit.duration).toBe(200);
    expect(exit.css?.(0, 1)).toContain('transform: scale(0.72)');
    expect(exit.easing?.(0.5)).toBeCloseTo(0.125);
  });

  it('uses opacity-only hull transitions when reduced or panel motion is disabled', () => {
    useReducedMotion(true);
    const reduced = activityHullTransition(document.createElement('div'));
    expect(reduced.duration).toBe(140);
    expect(reduced.css?.(0.5, 0.5)).toBe('opacity: 0.5');

    useReducedMotion(false);
    const parent = document.createElement('div');
    parent.dataset.motionEnabled = 'false';
    const child = parent.appendChild(document.createElement('div'));
    const disabled = activityHullTransition(child, { exit: true });
    expect(disabled.duration).toBe(140);
    expect(disabled.css?.(0.5, 0.5)).not.toContain('transform');
  });
});

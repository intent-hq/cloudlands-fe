import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrollBottomButtonVisibility } from '../scroll-bottom-button-visibility';

const THRESHOLD = 30;
const HYSTERESIS = 30;
const SETTLE_MS = 150;

function controller() {
  const onVisibilityChange = vi.fn();
  const onRelock = vi.fn();
  const instance = createScrollBottomButtonVisibility({
    atBottomThreshold: THRESHOLD,
    showHysteresis: HYSTERESIS,
    showSettleMs: SETTLE_MS,
    onVisibilityChange,
    onRelock,
  });
  return { instance, onVisibilityChange, onRelock };
}

describe('createScrollBottomButtonVisibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden while per-frame jitter oscillates across the at-bottom threshold', () => {
    // The flicker regression: distanceFromBottom bounces across the 30px
    // threshold every frame (e.g. lazy-turn placeholder swaps). The rendered
    // state must not strobe.
    const { instance, onVisibilityChange, onRelock } = controller();
    for (let frame = 0; frame < 120; frame++) {
      instance.update(frame % 2 === 0 ? 45 : 5);
      vi.advanceTimersByTime(16);
    }
    expect(instance.visible).toBe(false);
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect(onRelock).not.toHaveBeenCalled();
  });

  it('stays hidden under large-amplitude oscillation that clears the hysteresis band', () => {
    // Amplitude beyond the band: each dip back to the bottom cancels the
    // pending show before the settle window elapses.
    const { instance, onVisibilityChange, onRelock } = controller();
    for (let frame = 0; frame < 120; frame++) {
      instance.update(frame % 2 === 0 ? 300 : 0);
      vi.advanceTimersByTime(16);
    }
    expect(instance.visible).toBe(false);
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect(onRelock).not.toHaveBeenCalled();
  });

  it('shows after the distance holds beyond the show threshold for the settle window', () => {
    const { instance, onVisibilityChange } = controller();
    instance.update(500);
    expect(instance.visible).toBe(false);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(instance.visible).toBe(false);
    vi.advanceTimersByTime(1);
    expect(instance.visible).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
  });

  it('does not show inside the hysteresis band even when held there', () => {
    const { instance, onVisibilityChange } = controller();
    instance.update(THRESHOLD + HYSTERESIS); // at the band edge, not beyond it
    vi.advanceTimersByTime(SETTLE_MS * 10);
    expect(instance.visible).toBe(false);
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it('keeps a shown button visible through band-level jitter and hides only at the bottom', () => {
    const { instance, onVisibilityChange, onRelock } = controller();
    instance.update(500);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(instance.visible).toBe(true);

    // Jitter within the hysteresis band (above the at-bottom threshold).
    for (let frame = 0; frame < 60; frame++) {
      instance.update(frame % 2 === 0 ? 45 : 35);
      vi.advanceTimersByTime(16);
    }
    expect(instance.visible).toBe(true);
    expect(onRelock).not.toHaveBeenCalled();

    instance.update(0);
    expect(instance.visible).toBe(false);
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
    expect(onRelock).toHaveBeenCalledTimes(1);
  });

  it('fires the re-lock exactly once when jitter follows a genuine return to the bottom', () => {
    const { instance, onRelock } = controller();
    instance.update(500);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(instance.visible).toBe(true);

    for (let frame = 0; frame < 120; frame++) {
      instance.update(frame % 2 === 0 ? 0 : 300);
      vi.advanceTimersByTime(16);
    }
    expect(instance.visible).toBe(false);
    expect(onRelock).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending show when the distance settles back at the bottom', () => {
    const { instance, onVisibilityChange } = controller();
    instance.update(500);
    vi.advanceTimersByTime(SETTLE_MS - 10);
    instance.update(0);
    vi.advanceTimersByTime(SETTLE_MS * 10);
    expect(instance.visible).toBe(false);
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it('destroy cancels a pending show', () => {
    const { instance, onVisibilityChange } = controller();
    instance.update(500);
    instance.destroy();
    vi.advanceTimersByTime(SETTLE_MS * 10);
    expect(instance.visible).toBe(false);
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });
});

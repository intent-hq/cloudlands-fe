import { describe, expect, it, vi } from 'vitest';
import { createDockPointerPresenceTracker } from './dock-pointer-presence';

describe('dock presence resynchronization', () => {
  it('reports the first valid outside sample after capture without treating it as entry', () => {
    const emit = vi.fn();
    const tracker = createDockPointerPresenceTracker(emit);
    const sample = { inside: false, x: 300, y: 300, revision: 4, suppressed: false };
    tracker.update({ ...sample, inside: true });
    emit.mockClear();
    tracker.update({ ...sample, suppressed: true });
    tracker.reset();
    expect(emit).not.toHaveBeenCalled();
    expect(tracker.update(sample)).toBe(false);
    expect(emit).toHaveBeenCalledWith({ inside: false, x: 300, y: 300, revision: 4 });
    tracker.update(sample);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(tracker.update({ ...sample, inside: true, x: 20, y: 20 })).toBe(true);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

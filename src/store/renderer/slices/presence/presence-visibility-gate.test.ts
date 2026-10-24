import { describe, expect, it } from 'vitest';
import {
  applyPresenceVisibilityEvent,
  type PresenceVisibilityEvent,
  type PresenceVisibilityGate,
} from './presence-visibility-gate';

function run(initial: PresenceVisibilityGate, events: PresenceVisibilityEvent[]) {
  let gate = initial;
  const reports: boolean[] = [];
  for (const event of events) {
    const next = applyPresenceVisibilityEvent(gate, event);
    gate = next.gate;
    if (next.report !== null) reports.push(next.report);
  }
  return { gate, reports };
}

describe('applyPresenceVisibilityEvent', () => {
  it('reports ordinary visibility changes', () => {
    expect(
      run({ reported: true, captureActive: false }, [
        { kind: 'document', visible: false },
        { kind: 'document', visible: true },
      ]).reports,
    ).toEqual([false, true]);
  });

  // A screenshot of an agent tab while the user has Intent minimized makes
  // the app document briefly visible; presence must keep the user away.
  it('never reports the visibility a capture causes on a minimized window', () => {
    const { reports, gate } = run({ reported: false, captureActive: false }, [
      { kind: 'capture', active: true, documentVisible: false },
      { kind: 'document', visible: true },
      { kind: 'document', visible: false },
      { kind: 'capture', active: false, documentVisible: false },
    ]);
    expect(reports).toEqual([]);
    expect(gate).toEqual({ reported: false, captureActive: false });
  });

  it('reports a real change that happened during a capture once the capture ends', () => {
    // The user restored the window mid-capture: visible once the hold ends.
    expect(
      run({ reported: false, captureActive: false }, [
        { kind: 'capture', active: true, documentVisible: false },
        { kind: 'document', visible: true },
        { kind: 'capture', active: false, documentVisible: true },
      ]).reports,
    ).toEqual([true]);
  });

  it('keeps a visible window visible through a capture', () => {
    expect(
      run({ reported: true, captureActive: false }, [
        { kind: 'capture', active: true, documentVisible: true },
        { kind: 'capture', active: false, documentVisible: true },
      ]).reports,
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { dockSelectionOutcome } from './dock-selection-outcome';

describe('window/region selection outcome', () => {
  it('uses a written image', () => {
    expect(dockSelectionOutcome({ error: null, wroteImage: true })).toBe('image');
  });

  it('treats a dismissed selection (no file, exit 0 or 1) as cancelled', () => {
    expect(dockSelectionOutcome({ error: null, wroteImage: false })).toBe('cancelled');
    expect(dockSelectionOutcome({ error: { code: 1 }, wroteImage: false })).toBe('cancelled');
  });

  it('never reports a failure as a cancellation', () => {
    // The process could not start.
    expect(dockSelectionOutcome({ error: { code: 'ENOENT' }, wroteImage: false })).toBe('failed');
    // Stopped at the deadline, even if a partial file exists.
    expect(
      dockSelectionOutcome({
        error: { killed: true, signal: 'SIGTERM', code: null },
        wroteImage: true,
      }),
    ).toBe('timeout');
    // Any other exit without an image.
    expect(dockSelectionOutcome({ error: { code: 2 }, wroteImage: false })).toBe('failed');
  });
});

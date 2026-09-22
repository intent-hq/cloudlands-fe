import { describe, expect, it } from 'vitest';
import { summarizeAuroraFrames } from '../aurora-performance';

describe('aura measurements', () => {
  it('normalizes draw work over wall time, including pauses', () => {
    const report = summarizeAuroraFrames(
      [
        { time: 1000, submissionMs: 0.2, width: 800, height: 272 },
        { time: 1034, submissionMs: 0.3, width: 800, height: 272 },
        { time: 1500, submissionMs: 0.1, width: 800, height: 272 },
      ],
      2000,
    );
    expect(report.drawsPerSecond).toBe(1.5);
    expect(report.submissionMsPerSecond).toBeCloseTo(0.3);
    expect(report.longestIntervalMs).toBe(466);
    expect(report.intervalP95Ms).toBe(466);
    expect(report.resized).toBe(false);
  });

  it('does not invent timing or resolution for an off or paused aura', () => {
    expect(summarizeAuroraFrames([], 1000)).toMatchObject({
      draws: 0,
      drawsPerSecond: 0,
      intervalP95Ms: null,
      backingWidth: null,
    });
  });

  it('detects a backing-buffer resize during the measurement', () => {
    expect(
      summarizeAuroraFrames(
        [
          { time: 1, submissionMs: 0.1, width: 400, height: 136 },
          { time: 34, submissionMs: 0.1, width: 800, height: 272 },
        ],
        1000,
      ).resized,
    ).toBe(true);
  });
});

/** Optional, mount-scoped controls for the isolated developer benchmark. */
export interface AuroraBenchmarkOptions {
  pixelRatio: 'native' | 0.5;
  frameRate: 30 | 'display';
  seed: number;
  onDraw: (frame: AuroraFrameSample) => void;
}

export interface AuroraFrameSample {
  time: number;
  submissionMs: number;
  width: number;
  height: number;
}

/** CPU submission and draw cadence, not GPU execution or presented-frame timing. */
export function summarizeAuroraFrames(frames: AuroraFrameSample[], durationMs: number) {
  const intervals = frames.slice(1).map((frame, index) => frame.time - frames[index].time);
  const sorted = [...intervals].sort((a, b) => a - b);
  const submissionMs = frames.reduce((sum, frame) => sum + frame.submissionMs, 0);
  return {
    durationMs,
    draws: frames.length,
    drawsPerSecond: durationMs > 0 ? (frames.length * 1000) / durationMs : 0,
    submissionMs,
    submissionMsPerSecond: durationMs > 0 ? (submissionMs * 1000) / durationMs : 0,
    intervalP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    longestIntervalMs: sorted.length ? sorted[sorted.length - 1] : null,
    backingWidth: frames[0]?.width ?? null,
    backingHeight: frames[0]?.height ?? null,
    resized: frames.some(
      (frame) => frame.width !== frames[0].width || frame.height !== frames[0].height,
    ),
  };
}

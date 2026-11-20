/**
 * Live input meter for a recording's microphone stream: a Web Audio analyser
 * sampled on a timer and reduced to dictation bar levels. Optional by design —
 * where Web Audio is missing or fails, the recording continues without levels.
 */

import { spectrumBands } from '$features/voice/utils/spectrum-bands';

const SAMPLE_INTERVAL_MS = 66;

/** Start metering `stream`; returns a stop function (always safe to call). */
export function startInputLevelMeter(
  stream: MediaStream,
  onLevels: (levels: number[]) => void,
): () => void {
  const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (typeof AudioContextCtor !== 'function') return () => {};
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode;
  try {
    context = new AudioContextCtor();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -25;
    source.connect(analyser);
  } catch {
    // A partly built graph must not outlive the recording.
    source?.disconnect();
    void context?.close().catch(() => {});
    return () => {};
  }
  if (!context || !source) return () => {};
  const liveContext = context;
  const liveSource = source;
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const timer = setInterval(() => {
    analyser.getByteFrequencyData(bins);
    onLevels(spectrumBands(bins, liveContext.sampleRate));
  }, SAMPLE_INTERVAL_MS);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    liveSource.disconnect();
    void liveContext.close().catch(() => {});
  };
}

/**
 * Dictation with point-of-speech mark references.
 *
 * The installed engines (daemon `voice.transcribe`, OS recognizer) are batch
 * only: no partial results and no word timings. A click while dictating stores
 * its audio offset; on stop the recording is decoded once, split at those
 * offsets and each span transcribed in order, so the editor receives one
 * insertion `[text, mark, text, …]` with every chip where it was spoken.
 */
import type { DockInsertionPart } from '$shared/dock-evidence';
import { blobToWav, encodeWavPcm16, WAV_SAMPLE_RATE } from '$features/voice/utils/wav-encoder';

/** Default silence auto-stop. */
const DOCK_DICTATION_SILENCE_MS = 8_000;
/** Spans shorter than this are not worth a transcription call. */
const MIN_SPAN_MS = 250;
const WAV_HEADER_BYTES = 44;

export interface DockDictationClick {
  markId: string;
  offsetMs: number;
}

export interface DockDictationSpan {
  startMs: number;
  endMs: number;
  /** Mark spoken at the end of this span; absent for the final span. */
  markId?: string;
}

/** Ordered spans between clicks; clicks outside the recording clamp to its ends. */
export function dictationSpans(
  durationMs: number,
  clicks: readonly DockDictationClick[],
): DockDictationSpan[] {
  const end = Math.max(0, durationMs);
  const ordered = clicks
    .filter((click) => Number.isFinite(click.offsetMs) && click.markId)
    .map((click) => ({ ...click, offsetMs: Math.min(end, Math.max(0, click.offsetMs)) }))
    .sort((a, b) => a.offsetMs - b.offsetMs);
  const spans: DockDictationSpan[] = [];
  let start = 0;
  for (const click of ordered) {
    spans.push({ startMs: start, endMs: click.offsetMs, markId: click.markId });
    start = click.offsetMs;
  }
  spans.push({ startMs: start, endMs: end });
  return spans;
}

/** Join transcribed spans with their marks, normalizing whitespace at the seams. */
export function joinDictationSpans(
  spans: readonly DockDictationSpan[],
  texts: readonly string[],
): DockInsertionPart[] {
  const parts: DockInsertionPart[] = [];
  spans.forEach((span, index) => {
    const text = (texts[index] ?? '').replace(/\s+/g, ' ').trim();
    if (text) {
      const previous = parts.at(-1);
      parts.push({ kind: 'text', text: previous?.kind === 'mark' ? ` ${text}` : text });
    }
    if (span.markId) {
      const previous = parts.at(-1);
      if (previous?.kind === 'text' && !previous.text.endsWith(' '))
        parts[parts.length - 1] = { kind: 'text', text: `${previous.text} ` };
      parts.push({ kind: 'mark', markId: span.markId });
    }
  });
  return parts;
}

/** Split 16 kHz mono PCM16 WAV bytes (as produced by `blobToWav`) into per-span WAVs. */
function sliceWav(wav: ArrayBuffer, spans: readonly DockDictationSpan[]): ArrayBuffer[] {
  const pcm = new Int16Array(wav, WAV_HEADER_BYTES, (wav.byteLength - WAV_HEADER_BYTES) >> 1);
  return spans.map((span) => {
    const from = Math.min(pcm.length, Math.floor((span.startMs / 1000) * WAV_SAMPLE_RATE));
    const to = Math.min(
      pcm.length,
      Math.max(from, Math.ceil((span.endMs / 1000) * WAV_SAMPLE_RATE)),
    );
    const samples = new Float32Array(to - from);
    for (let i = from; i < to; i += 1) samples[i - from] = pcm[i] / 0x8000;
    return encodeWavPcm16(samples, WAV_SAMPLE_RATE);
  });
}

export interface DockDictationDeps {
  /** Canonical engine call for one WAV span (daemon or OS), returning plain text. */
  transcribe: (wav: Blob) => Promise<string>;
  decode?: (audio: Blob) => Promise<ArrayBuffer>;
}

/**
 * Transcribe one finished recording at its click offsets. Spans are transcribed
 * sequentially so engine concurrency limits and ordering are respected; a span
 * failure rejects the whole result (the caller keeps marks and reports failure).
 */
export async function transcribeDictationAtMarks(
  audio: Blob,
  durationMs: number,
  clicks: readonly DockDictationClick[],
  deps: DockDictationDeps,
): Promise<DockInsertionPart[]> {
  const spans = dictationSpans(durationMs, clicks);
  const wav = await (deps.decode ?? blobToWav)(audio);
  const slices = sliceWav(wav, spans);
  const texts: string[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    texts.push(
      span.endMs - span.startMs < MIN_SPAN_MS
        ? ''
        : await deps.transcribe(new Blob([slices[i]], { type: 'audio/wav' })),
    );
  }
  return joinDictationSpans(spans, texts);
}

/**
 * Silence auto-stop from normalized input levels (0..1, the same samples the
 * waveform renders). Pure: feed levels with timestamps; `true` means stop.
 */
export function createDockSilenceDetector(
  silenceMs: number = DOCK_DICTATION_SILENCE_MS,
  threshold = 0.04,
) {
  let lastVoice: number | null = null;
  return {
    feed(level: number, now: number): boolean {
      if (lastVoice === null || level > threshold) lastVoice = now;
      return now - lastVoice >= silenceMs;
    },
    reset(): void {
      lastVoice = null;
    },
  };
}

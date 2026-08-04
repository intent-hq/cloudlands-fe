/**
 * Push-to-talk microphone recorder: getUserMedia + MediaRecorder
 * (webm/opus) with a hard max-duration auto-stop. Handles the
 * keyup-before-media-ready race: a stop/cancel requested while the
 * microphone is still being acquired discards the session (nothing was
 * captured yet). Single-use — one instance per recording.
 *
 * Pure web code — no Electron imports, no store imports.
 */

/** Hard recording cap: the recorder auto-stops after this long. */
export const PTT_MAX_RECORDING_MS = 120_000;

/** Preferred container/codec, most-specific first. */
export const PTT_PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

export interface VoiceRecordingResult {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

export interface VoiceRecorderCallbacks {
  /** Recording finished (release or auto-stop) with the captured audio. */
  onFinished(result: VoiceRecordingResult): void;
  /** Microphone acquisition or recording failed. */
  onError(error: unknown): void;
}

export interface VoiceRecorderOptions extends VoiceRecorderCallbacks {
  /** Hard cap; the recorder stops itself when reached. Defaults to {@link PTT_MAX_RECORDING_MS}. */
  maxDurationMs?: number;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

export type VoiceRecorderState = 'idle' | 'starting' | 'recording' | 'stopped';

/**
 * How `start()` settled: `recording` = capture is live, `discarded` =
 * stop/cancel won the race against the mic acquisition (no callbacks
 * fired), `error` = acquisition failed (`onError` fired).
 */
export type VoiceRecorderStartOutcome = 'recording' | 'discarded' | 'error';

/** Whether this environment can record (mic access + MediaRecorder). */
export function isVoiceRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** The most specific supported mime type, or undefined for the browser default. */
export function pickRecorderMimeType(): string | undefined {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return undefined;
  }
  return PTT_PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export class VoiceRecorder {
  private readonly maxDurationMs: number;
  private readonly now: () => number;
  private readonly callbacks: VoiceRecorderCallbacks;

  private currentState: VoiceRecorderState = 'idle';
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  /** stop()/cancel() arrived while the mic was still being acquired. */
  private discardRequested = false;
  /** cancel(): the onstop handler drops the audio instead of finishing. */
  private cancelRequested = false;

  constructor(options: VoiceRecorderOptions) {
    this.maxDurationMs = options.maxDurationMs ?? PTT_MAX_RECORDING_MS;
    this.now = options.now ?? Date.now;
    this.callbacks = { onFinished: options.onFinished, onError: options.onError };
  }

  get state(): VoiceRecorderState {
    return this.currentState;
  }

  async start(): Promise<VoiceRecorderStartOutcome> {
    if (this.currentState !== 'idle') return 'discarded';
    this.currentState = 'starting';
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const discarded = this.discardRequested;
      this.currentState = 'stopped';
      if (!discarded) this.callbacks.onError(error);
      return discarded ? 'discarded' : 'error';
    }
    if (this.discardRequested) {
      for (const track of stream.getTracks()) track.stop();
      this.currentState = 'stopped';
      return 'discarded';
    }
    this.stream = stream;
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    this.recorder = recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => this.handleRecorderStop();
    recorder.onerror = (event) => this.handleRecorderError(event);
    recorder.start();
    this.startedAt = this.now();
    this.currentState = 'recording';
    this.maxTimer = setTimeout(() => this.stop(), this.maxDurationMs);
    return 'recording';
  }

  /** Keyup: finish the recording and deliver the captured audio. */
  stop(): void {
    if (this.currentState === 'starting') {
      this.discardRequested = true;
      return;
    }
    if (this.currentState !== 'recording') return;
    this.recorder?.stop();
  }

  /** Discard: stop capture, deliver nothing (device disconnect mid-hold). */
  cancel(): void {
    if (this.currentState === 'starting') {
      this.discardRequested = true;
      return;
    }
    if (this.currentState !== 'recording') return;
    this.cancelRequested = true;
    this.recorder?.stop();
  }

  private handleRecorderStop(): void {
    const durationMs = this.now() - this.startedAt;
    const mimeType = this.recorder?.mimeType || 'audio/webm';
    const chunks = this.chunks;
    const cancelled = this.cancelRequested;
    this.teardown();
    if (cancelled) return;
    this.callbacks.onFinished({ blob: new Blob(chunks, { type: mimeType }), durationMs, mimeType });
  }

  private handleRecorderError(event: unknown): void {
    const error = (event as { error?: unknown })?.error ?? event;
    this.teardown();
    this.callbacks.onError(error);
  }

  private teardown(): void {
    if (this.maxTimer !== null) clearTimeout(this.maxTimer);
    this.maxTimer = null;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
    }
    this.recorder = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.chunks = [];
    this.currentState = 'stopped';
  }
}

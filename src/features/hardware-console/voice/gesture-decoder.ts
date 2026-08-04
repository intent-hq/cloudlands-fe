/**
 * Voice-key gesture decoder: a small state machine that turns raw
 * keydown/keyup timing on the hardware voice key into one of four gestures:
 *
 * - **Press & hold** — PTT: record while held; release stops (no send).
 * - **Single press (tap)** — latch: recording continues; a later single
 *   press stops it (no send).
 * - **Double press** — send: stop any active recording with `autoSend`.
 * - **Double press & hold** — PTT + send: record while the second press is
 *   held; release stops with `autoSend`.
 *
 * Recording starts on the FIRST keydown of every gesture (`onRecordStart`)
 * so no speech is lost during disambiguation — the gesture only decides
 * when recording stops (`onRecordStop`) and whether to auto-send. Decoder
 * only; it never touches the recorder or the store (the ptt-controller
 * wires it). Timing thresholds are injectable for tuning and tests.
 */

/** A press shorter than this is a tap; held longer, it's a hold. */
export const VOICE_HOLD_THRESHOLD_MS = 300;

/** A second keydown within this window after a tap makes a double press. */
export const VOICE_DOUBLE_PRESS_WINDOW_MS = 300;

export type VoiceGestureStopReason =
  | 'hold-release'
  | 'latch-stop'
  | 'double-press'
  | 'double-hold-release';

/** How a gesture ended and whether it requests an auto-send. */
export interface VoiceGestureOutcome {
  stopReason: VoiceGestureStopReason;
  autoSend: boolean;
}

export type VoiceGestureDecoderState =
  | 'idle'
  | 'first-press'
  | 'holding'
  | 'await-second-press'
  | 'second-press'
  | 'holding-send'
  | 'latched'
  | 'latched-press'
  | 'latched-await-second'
  | 'draining';

export interface VoiceGestureDecoderOptions {
  /** First keydown of a gesture: start recording now. */
  onRecordStart(): void;
  /** Gesture resolved: stop recording (if live) with this outcome. */
  onRecordStop(outcome: VoiceGestureOutcome): void;
  /** Defaults to {@link VOICE_HOLD_THRESHOLD_MS}. */
  holdThresholdMs?: number;
  /** Defaults to {@link VOICE_DOUBLE_PRESS_WINDOW_MS}. */
  doublePressWindowMs?: number;
}

export class VoiceGestureDecoder {
  private readonly holdThresholdMs: number;
  private readonly doublePressWindowMs: number;
  private readonly onRecordStart: () => void;
  private readonly onRecordStop: (outcome: VoiceGestureOutcome) => void;

  private currentState: VoiceGestureDecoderState = 'idle';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VoiceGestureDecoderOptions) {
    this.holdThresholdMs = options.holdThresholdMs ?? VOICE_HOLD_THRESHOLD_MS;
    this.doublePressWindowMs = options.doublePressWindowMs ?? VOICE_DOUBLE_PRESS_WINDOW_MS;
    this.onRecordStart = options.onRecordStart;
    this.onRecordStop = options.onRecordStop;
  }

  get state(): VoiceGestureDecoderState {
    return this.currentState;
  }

  keyDown(): void {
    switch (this.currentState) {
      case 'idle':
        this.currentState = 'first-press';
        this.armTimer(this.holdThresholdMs, () => {
          this.currentState = 'holding';
        });
        this.onRecordStart();
        break;
      case 'await-second-press':
        this.clearTimer();
        this.currentState = 'second-press';
        this.armTimer(this.holdThresholdMs, () => {
          this.currentState = 'holding-send';
        });
        break;
      case 'latched':
        this.currentState = 'latched-press';
        break;
      case 'latched-await-second':
        // Second press of a double while latched: stop + send immediately;
        // 'draining' absorbs this press's keyup.
        this.clearTimer();
        this.currentState = 'draining';
        this.onRecordStop({ stopReason: 'double-press', autoSend: true });
        break;
      default:
        // Duplicate keydown while already pressed: ignore.
        break;
    }
  }

  keyUp(): void {
    switch (this.currentState) {
      case 'first-press':
        this.clearTimer();
        this.currentState = 'await-second-press';
        this.armTimer(this.doublePressWindowMs, () => {
          this.currentState = 'latched';
        });
        break;
      case 'holding':
        this.currentState = 'idle';
        this.onRecordStop({ stopReason: 'hold-release', autoSend: false });
        break;
      case 'second-press':
        this.clearTimer();
        this.currentState = 'idle';
        this.onRecordStop({ stopReason: 'double-press', autoSend: true });
        break;
      case 'holding-send':
        this.currentState = 'idle';
        this.onRecordStop({ stopReason: 'double-hold-release', autoSend: true });
        break;
      case 'latched-press':
        this.currentState = 'latched-await-second';
        this.armTimer(this.doublePressWindowMs, () => {
          this.currentState = 'idle';
          this.onRecordStop({ stopReason: 'latch-stop', autoSend: false });
        });
        break;
      case 'draining':
        this.currentState = 'idle';
        break;
      default:
        // Keyup with no tracked press (post-reset, spurious): ignore.
        break;
    }
  }

  /** Abandon any in-flight gesture (device disconnect, teardown). */
  reset(): void {
    this.clearTimer();
    this.currentState = 'idle';
  }

  private armTimer(delayMs: number, fire: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      fire();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

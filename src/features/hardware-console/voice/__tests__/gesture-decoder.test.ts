import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_DOUBLE_PRESS_WINDOW_MS,
  VOICE_HOLD_THRESHOLD_MS,
  VoiceGestureDecoder,
  type VoiceGestureOutcome,
} from '../gesture-decoder';

describe('voice gesture decoder', () => {
  let starts: number;
  let stops: VoiceGestureOutcome[];
  let decoder: VoiceGestureDecoder;

  beforeEach(() => {
    vi.useFakeTimers();
    starts = 0;
    stops = [];
    decoder = new VoiceGestureDecoder({
      onRecordStart: () => {
        starts += 1;
      },
      onRecordStop: (outcome) => {
        stops.push(outcome);
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recording starts on the first keydown of every gesture', () => {
    decoder.keyDown();
    expect(starts).toBe(1);
    expect(stops).toEqual([]);
  });

  it('press & hold = PTT: release after the hold threshold stops without send', () => {
    decoder.keyDown();
    vi.advanceTimersByTime(VOICE_HOLD_THRESHOLD_MS);
    decoder.keyUp();
    expect(stops).toEqual([{ stopReason: 'hold-release', autoSend: false }]);
    expect(decoder.state).toBe('idle');
  });

  it('single press (tap) = latch: recording continues; a later tap stops without send', () => {
    decoder.keyDown();
    decoder.keyUp();
    vi.advanceTimersByTime(VOICE_DOUBLE_PRESS_WINDOW_MS);
    expect(decoder.state).toBe('latched');
    expect(stops).toEqual([]);

    decoder.keyDown();
    decoder.keyUp();
    vi.advanceTimersByTime(VOICE_DOUBLE_PRESS_WINDOW_MS);
    expect(starts).toBe(1);
    expect(stops).toEqual([{ stopReason: 'latch-stop', autoSend: false }]);
    expect(decoder.state).toBe('idle');
  });

  it('double press = send: stops with autoSend', () => {
    decoder.keyDown();
    decoder.keyUp();
    decoder.keyDown();
    decoder.keyUp();
    expect(starts).toBe(1);
    expect(stops).toEqual([{ stopReason: 'double-press', autoSend: true }]);
    expect(decoder.state).toBe('idle');
  });

  it('double press & hold = PTT + send: second-press release stops with autoSend', () => {
    decoder.keyDown();
    decoder.keyUp();
    decoder.keyDown();
    vi.advanceTimersByTime(VOICE_HOLD_THRESHOLD_MS);
    expect(stops).toEqual([]);
    decoder.keyUp();
    expect(stops).toEqual([{ stopReason: 'double-hold-release', autoSend: true }]);
    expect(decoder.state).toBe('idle');
  });

  it('double press while latched stops with autoSend and drains the extra keyup', () => {
    decoder.keyDown();
    decoder.keyUp();
    vi.advanceTimersByTime(VOICE_DOUBLE_PRESS_WINDOW_MS);
    // Latched. Double press: tap, then second press fires the send.
    decoder.keyDown();
    decoder.keyUp();
    decoder.keyDown();
    expect(stops).toEqual([{ stopReason: 'double-press', autoSend: true }]);
    decoder.keyUp();
    expect(decoder.state).toBe('idle');
    expect(starts).toBe(1);
  });

  it('a fresh gesture after a resolved one starts a new recording', () => {
    decoder.keyDown();
    vi.advanceTimersByTime(VOICE_HOLD_THRESHOLD_MS);
    decoder.keyUp();
    decoder.keyDown();
    expect(starts).toBe(2);
  });

  it('custom thresholds are honored', () => {
    const custom = new VoiceGestureDecoder({
      onRecordStart: () => {
        starts += 1;
      },
      onRecordStop: (outcome) => {
        stops.push(outcome);
      },
      holdThresholdMs: 100,
      doublePressWindowMs: 50,
    });
    custom.keyDown();
    vi.advanceTimersByTime(100);
    custom.keyUp();
    expect(stops).toEqual([{ stopReason: 'hold-release', autoSend: false }]);

    custom.keyDown();
    custom.keyUp();
    vi.advanceTimersByTime(50);
    expect(custom.state).toBe('latched');
  });

  it('reset abandons an in-flight gesture without firing callbacks', () => {
    decoder.keyDown();
    decoder.reset();
    vi.advanceTimersByTime(VOICE_HOLD_THRESHOLD_MS + VOICE_DOUBLE_PRESS_WINDOW_MS);
    expect(decoder.state).toBe('idle');
    expect(stops).toEqual([]);
    // A keyup after reset is ignored; the next keydown starts fresh.
    decoder.keyUp();
    expect(stops).toEqual([]);
    decoder.keyDown();
    expect(starts).toBe(2);
  });

  it('duplicate keydown while already pressed is ignored', () => {
    decoder.keyDown();
    decoder.keyDown();
    expect(starts).toBe(1);
    vi.advanceTimersByTime(VOICE_HOLD_THRESHOLD_MS);
    decoder.keyUp();
    expect(stops).toEqual([{ stopReason: 'hold-release', autoSend: false }]);
  });
});

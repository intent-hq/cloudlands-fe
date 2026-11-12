/**
 * The recording tool bar's pure parts: shortcuts (never while typing) and the
 * waveform's level history; and the mirrored recording's paused-aware elapsed time.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCK_RECORDING_WAVE_BARS,
  dockRecordingShortcut,
  pushDockRecordingLevel,
} from './dock-recording-toolbar';
import { dockRecordingElapsedMs, sanitizeDockAnnotationMedia } from '$shared/dock-annotation';
import { dockAnnotationMediaRecording } from './dock-annotation-overlay.fixtures';
import { formatDockElapsed } from '$features/hud/composer/dock-annotation-bar-media';

const key = (value: string, target: EventTarget | null = null, mods = {}) =>
  dockRecordingShortcut({
    key: value,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target,
    ...mods,
  });

describe('dockRecordingShortcut', () => {
  it('maps V/R/D/A, Space, Enter and Esc, case-insensitively', () => {
    expect(key('v')).toEqual({ kind: 'tool', tool: 'pointer' });
    expect(key('E')).toBeNull();
    expect(key('r')).toEqual({ kind: 'tool', tool: 'box' });
    expect(key('d')).toEqual({ kind: 'tool', tool: 'pen' });
    expect(key('a')).toEqual({ kind: 'tool', tool: 'arrow' });
    expect(key(' ')).toEqual({ kind: 'pause' });
    expect(key('Enter')).toEqual({ kind: 'done' });
    expect(key('Escape')).toEqual({ kind: 'escape' });
    expect(key('x')).toBeNull();
  });

  it('never fires with a modifier or while typing in a field', () => {
    expect(key('r', null, { metaKey: true })).toBeNull();
    for (const html of [
      '<input>',
      '<textarea></textarea>',
      '<div contenteditable="true"><b></b></div>',
    ]) {
      const host = document.createElement('div');
      host.innerHTML = html;
      const target = host.querySelector('b') ?? host.firstElementChild;
      expect(key('r', target), html).toBeNull();
      expect(key(' ', target), html).toBeNull();
    }
  });
});

describe('pushDockRecordingLevel', () => {
  it('keeps the newest levels, clamped, at a fixed length', () => {
    let history = pushDockRecordingLevel([], 0.5);
    expect(history).toEqual([0, 0, 0, 0, 0.5]);
    for (const level of [2, -1, Number.NaN, 0.25, 0.75])
      history = pushDockRecordingLevel(history, level);
    expect(history).toEqual([1, 0, 0, 0.25, 0.75]);
    expect(history).toHaveLength(DOCK_RECORDING_WAVE_BARS);
  });
});

describe('mirrored recording time', () => {
  it('cuts paused time and freezes while paused', () => {
    expect(dockRecordingElapsedMs({ startedAt: 1_000, pausedAt: null, pausedMs: 0 }, 43_000)).toBe(
      42_000,
    );
    expect(
      dockRecordingElapsedMs({ startedAt: 1_000, pausedAt: 20_000, pausedMs: 4_000 }, 99_000),
    ).toBe(15_000);
    expect(dockRecordingElapsedMs({ startedAt: null, pausedAt: null, pausedMs: 0 }, 5)).toBe(0);
  });

  it('formats m:ss, then h:mm:ss from one hour', () => {
    expect(formatDockElapsed(42_000)).toBe('0:42');
    expect(formatDockElapsed(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatDockElapsed(3_662_000)).toBe('1:01:02');
  });

  it('accepts the pause fields and refuses malformed ones', () => {
    const live = dockAnnotationMediaRecording(1_000, 5_000);
    expect(sanitizeDockAnnotationMedia(live)?.record).toMatchObject({
      pausedAt: 5_000,
      pausedMs: 0,
    });
    for (const record of [
      { ...live.record, pausedMs: -1 },
      { ...live.record, pausedAt: 'soon' },
      { ...live.record, pausedMs: undefined },
    ])
      expect(sanitizeDockAnnotationMedia({ ...live, record })).toBeNull();
  });
});

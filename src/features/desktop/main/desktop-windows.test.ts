import { describe, expect, it } from 'vitest';
import {
  DesktopWindowIds,
  describeWindows,
  targetReason,
  windowKey,
  type NativeWindow,
  type NativeWindowState,
} from './desktop-windows';

// States and cases mirror docs/protocol/fixtures/desktop-control/lifecycle.json
// (windowTargeting) in intent-hq/intent. The native handle doubles as the
// fixture windowId so cases read the same as the contract.
const frame = (handle: string, pid: number, x: number, y: number, width: number, height: number) =>
  ({ handle, pid, appName: `app-${pid}`, x, y, width, height }) satisfies NativeWindow;
const safari = frame('win-safari', 411, 200, 100, 1600, 1000);
const slack = frame('win-slack', 522, -120, 50, 1400, 900);
const intent = frame('win-intent', 633, 900, 300, 1200, 900);
const states: Record<string, NativeWindowState> = {
  'safari-front': { frontmost: { appName: 'Safari', pid: 411 }, windows: [safari, slack, intent] },
  'slack-front': { frontmost: { appName: 'Slack', pid: 522 }, windows: [slack, safari, intent] },
  'safari-front-slack-behind-same-app': {
    frontmost: { appName: 'Safari', pid: 411 },
    windows: [safari, frame('win-safari-2', 411, -120, 50, 1400, 900)],
  },
};
const pids: Record<string, number> = {
  'win-safari': 411,
  'win-slack': 522,
  'win-intent': 633,
  'win-safari-2': 411,
};
type Case = [
  id: string,
  state: string,
  windowId: string,
  point: { x: number; y: number } | undefined,
  reason: string | undefined,
];
const cases: Case[] = [
  ['click-in-front-window', 'safari-front', 'win-safari', { x: 300, y: 200 }, undefined],
  ['move-in-front-window', 'safari-front', 'win-safari', { x: 400, y: 400 }, undefined],
  ['scroll-in-front-window', 'safari-front', 'win-safari', { x: 500, y: 500 }, undefined],
  ['drag-from-window-to-other-app', 'safari-front', 'win-safari', { x: 300, y: 300 }, undefined],
  ['type-into-frontmost-app', 'safari-front', 'win-safari', undefined, undefined],
  ['keypress-into-frontmost-app', 'safari-front', 'win-safari', undefined, undefined],
  ['type-closed-window', 'safari-front', 'win-closed', undefined, 'window_unavailable'],
  ['type-while-slack-front', 'slack-front', 'win-safari', undefined, 'not_frontmost'],
  ['keypress-while-slack-front', 'slack-front', 'win-safari', undefined, 'not_frontmost'],
  ['click-background-app-window', 'safari-front', 'win-slack', { x: 50, y: 100 }, 'not_frontmost'],
  ['click-outside-target', 'safari-front', 'win-safari', { x: 100, y: 50 }, 'outside_window'],
  [
    'click-right-edge-exclusive',
    'safari-front',
    'win-safari',
    { x: 1800, y: 200 },
    'outside_window',
  ],
  ['drag-from-outside-target', 'safari-front', 'win-safari', { x: 100, y: 50 }, 'outside_window'],
  ['click-covered-part', 'slack-front', 'win-safari', { x: 800, y: 500 }, 'not_frontmost'],
  ['click-slack-under-safari', 'slack-front', 'win-slack', { x: 100, y: 200 }, undefined],
  [
    'click-obscured-same-app-window',
    'safari-front-slack-behind-same-app',
    'win-safari-2',
    { x: 300, y: 200 },
    'obscured',
  ],
];

describe('window target checks', () => {
  it.each(cases)('%s', (_id, state, windowId, point, reason) => {
    const key = pids[windowId] ? windowKey({ pid: pids[windowId], handle: windowId }) : undefined;
    expect(targetReason(states[state], key, point)).toBe(reason);
  });
  it('treats an unmapped (other-session) id as unavailable before any other check', () => {
    expect(targetReason(states['slack-front'], undefined, { x: 1, y: 1 })).toBe(
      'window_unavailable',
    );
  });
  it('does not match a reused handle owned by another process', () => {
    expect(
      targetReason(states['safari-front'], windowKey({ pid: 999, handle: 'win-safari' })),
    ).toBe('window_unavailable');
  });
});

describe('session window ids', () => {
  it('are opaque, stable per window and never shared across sessions', () => {
    const first = new DesktopWindowIds();
    const a = first.idFor(safari);
    expect(first.idFor({ ...safari, x: 0 })).toBe(a);
    expect(first.idFor(slack)).not.toBe(a);
    expect(first.keyFor(a)).toBe(windowKey(safari));
    const second = new DesktopWindowIds();
    expect(second.keyFor(a)).toBeUndefined();
    expect(second.idFor(safari)).not.toBe(a);
  });
});

describe('recycled native handles', () => {
  // Helpers report handles with a lifetime generation ("<hwnd>.<gen>" on
  // Windows, where HWNDs can be recycled), so a replacement window that reuses
  // a destroyed window's handle in the same process is a different identity.
  it('never resolves an old id to a replacement window with a recycled handle', () => {
    const ids = new DesktopWindowIds();
    const closed = frame('5.0', 411, 200, 100, 800, 600);
    const oldId = ids.idFor(closed);
    const replacement = frame('5.1', 411, 200, 100, 800, 600);
    const state: NativeWindowState = {
      frontmost: { appName: 'Safari', pid: 411 },
      windows: [replacement],
    };
    expect(targetReason(state, ids.keyFor(oldId), { x: 300, y: 200 })).toBe('window_unavailable');
    expect(ids.idFor(replacement)).not.toBe(oldId);
  });
  it('never targets a window whose identity the helper could not tag', () => {
    const ids = new DesktopWindowIds();
    const elevated = frame('9.unverified', 411, 0, 0, 800, 600);
    const state: NativeWindowState = {
      frontmost: { appName: 'Admin', pid: 411 },
      windows: [elevated],
    };
    expect(targetReason(state, ids.keyFor(ids.idFor(elevated)))).toBe('window_unavailable');
  });
});

describe('screenshot window metadata', () => {
  const display = { width: 2880, height: 1800 };
  it('lists intersecting windows front-to-back with one focused entry and unclipped frames', () => {
    const ids = new DesktopWindowIds((n) => `w${n}`);
    const offscreen = frame('win-other-display', 411, 3000, 0, 800, 600);
    const state: NativeWindowState = {
      frontmost: {
        appName: 'Safari',
        bundleId: 'com.apple.Safari',
        pid: 411,
        focusedHandle: 'win-safari',
      },
      windows: [
        { ...safari, appName: 'Safari', bundleId: 'com.apple.Safari', title: 'Start Page' },
        { ...slack, appName: 'Slack', title: '' },
        offscreen,
      ],
    };
    const result = describeWindows(state, ids, display);
    expect(result).toEqual({
      frontmost: { appName: 'Safari', bundleId: 'com.apple.Safari', pid: 411, windowId: 'w1' },
      windows: [
        {
          windowId: 'w1',
          appName: 'Safari',
          bundleId: 'com.apple.Safari',
          pid: 411,
          title: 'Start Page',
          x: 200,
          y: 100,
          width: 1600,
          height: 1000,
          focused: true,
        },
        {
          windowId: 'w2',
          appName: 'Slack',
          pid: 522,
          x: -120,
          y: 50,
          width: 1400,
          height: 900,
          focused: false,
        },
      ],
    });
  });
  it('names a focused window on another display in frontmost but not in windows', () => {
    const ids = new DesktopWindowIds((n) => `w${n}`);
    const elsewhere = frame('win-elsewhere', 411, 3000, 0, 800, 600);
    const result = describeWindows(
      {
        frontmost: { appName: 'Safari', pid: 411, focusedHandle: 'win-elsewhere' },
        windows: [elsewhere],
      },
      ids,
      display,
    );
    expect(result.windows).toEqual([]);
    expect(result.frontmost).toEqual({ appName: 'Safari', pid: 411, windowId: 'w1' });
    expect(ids.keyFor('w1')).toBe(windowKey(elsewhere));
  });
  it('omits frontmost.windowId when the focused window is not eligible and frontmost when absent', () => {
    const ids = new DesktopWindowIds();
    expect(
      describeWindows(
        { frontmost: { appName: 'Finder', pid: 7, focusedHandle: 'menu' }, windows: [] },
        ids,
        display,
      ),
    ).toEqual({ frontmost: { appName: 'Finder', pid: 7 }, windows: [] });
    expect(describeWindows({ windows: [] }, ids, display)).toEqual({ windows: [] });
  });
});

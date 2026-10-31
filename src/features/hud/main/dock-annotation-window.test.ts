import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main/window-backend', () => ({ stampWindowWithBackend: vi.fn() }));
vi.mock('../../../main/dock-annotation-identity', () => ({
  registerDockAnnotationWindow: vi.fn(),
}));
vi.mock('../../../main/dock-window', () => ({ getDockWindow: () => null }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/fake/dist/main' },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  nativeImage: {},
  screen: { on: vi.fn(), removeListener: vi.fn(), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
}));

import type { BrowserWindow, Display } from 'electron';
import {
  DockAnnotationController,
  type DockAnnotationHost,
  type DockAnnotationNative,
  watchDockNavigation,
} from './dock-annotation-window';
import type { DockElementHit } from './dock-element-pick';
import {
  DOCK_ANNOTATION_CHANNELS,
  type DockAnnotationIssue,
} from '../../../shared/dock-annotation';
import type { DockEvidenceNativeEvent, DockMarkTool } from '../../../shared/dock-evidence';

// A secondary Retina display left of and above the primary (negative origin).
const DISPLAY = {
  id: 7,
  scaleFactor: 2,
  bounds: { x: -1440, y: -100, width: 1440, height: 900 },
} as Display;
const SAME_HASH = '0'.repeat(64);
const NEAR_HASH = 'f' + '0'.repeat(63); // 4 bits away
const FAR_HASH = 'fff' + '0'.repeat(61); // 12 bits away
const VERY_FAR_HASH = 'ffff' + '0'.repeat(60); // 16 bits away

class FakeWebContents extends EventEmitter {
  mainFrame = { id: 'main' };
  sent: unknown[] = [];
  destroyed = false;
  isDestroyed = () => this.destroyed;
  send = (channel: string, state: unknown) => {
    if (channel === DOCK_ANNOTATION_CHANNELS.STATE) this.sent.push(state);
  };
}

class FakeWindow extends EventEmitter {
  webContents = new FakeWebContents();
  destroyed = false;
  ignore: boolean[] = [];
  shown = 0;
  visible = false;
  backendId = '';
  isDestroyed = () => this.destroyed;
  isVisible = () => this.visible;
  setIgnoreMouseEvents = (ignore: boolean) => this.ignore.push(ignore);
  showInactive = () => {
    this.shown += 1;
    this.visible = true;
  };
  hide = () => {
    this.visible = false;
  };
  setBounds = () => {};
  getMediaSourceId = () => 'window:4242:0';
  destroy = () => {
    this.destroyed = true;
    this.webContents.destroyed = true;
    this.emit('closed');
  };
}

const appWindow = {
  pid: 900,
  windowId: 5,
  app: 'Browser',
  bounds: { x: -1440, y: -100, width: 1440, height: 900 },
};
const noHit: DockElementHit = {
  checked: true,
  access: 'granted',
  window: appWindow,
  element: null,
};

type Hit = (point: { x: number; y: number }, options: { element: boolean }) => DockElementHit;

function setup(
  options: {
    hashes?: string[];
    hit?: Hit;
    intent?: DockAnnotationNative['intentWindow'];
  } = {},
) {
  const windows: FakeWindow[] = [];
  const intervals: Array<() => void> = [];
  const captures: { excluded: number[] }[] = [];
  const hashes = [...(options.hashes ?? [SAME_HASH])];
  let resolveCapture: (() => void) | null = null;
  let holdCaptures = false;
  const io = {
    hit: options.hit ?? ((() => noHit) as Hit),
    shot: { width: 2880, height: 1800 } as Record<string, unknown>,
    captureError: null as null | 'permission' | 'unavailable',
    onCaptured: () => {},
  };
  const host: DockAnnotationHost & {
    display: Display | null;
    rects: unknown[];
    clip?: number;
    backend: string | null;
  } = {
    backend: 'remote-1',
    display: DISPLAY,
    rects: [{ x: -300, y: -100, width: 300, height: 900 }], // dock column, global DIP
    dockDisplay: () => host.display,
    excludedRects: () => host.rects as never,
    excludedWindowIds: () => [11, 12],
    capture: async (_display, excluded) => {
      captures.push({ excluded });
      if (holdCaptures) await new Promise<void>((resolve) => (resolveCapture = resolve));
      io.onCaptured();
      if (io.captureError) return { ok: false, error: io.captureError };
      return { ok: true, value: { png: Buffer.from('png'), ...io.shot } };
    },
    permissionDenied: () => false,
    retired: () => false,
    clipMs: () => host.clip,
    backendId: () => host.backend,
    onGestureStart: (annotationId, markId) => started.push(`${annotationId}/${markId}`),
    onGestureSettled: (annotationId, markId, outcome) =>
      settled.push(`${annotationId}/${markId}:${outcome}`),
  };
  const cursor = { x: -1000, y: 0 };
  const clock = { now: Date.parse('2026-10-29T18:12:04Z') };
  let ids = 0;
  const started: string[] = [];
  const settled: string[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const native: DockAnnotationNative = {
    createWindow: (_display, backendId) => {
      const window = new FakeWindow();
      window.backendId = backendId;
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    cursor: () => cursor,
    hash: () => hashes.shift() ?? SAME_HASH,
    picker: {
      hit: async (point, hitOptions) => io.hit(point, hitOptions),
      access: () => 'granted',
      warm: () => {},
      dispose: () => {},
    },
    now: () => clock.now,
    id: () => `mark-${++ids}`,
    setInterval: (callback) => {
      intervals.push(callback);
      return () => intervals.splice(intervals.indexOf(callback), 1);
    },
    setTimeout: (callback, ms) => {
      const timer = { callback, ms };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    onDisplaysChanged: () => () => {},
    intentWindow: options.intent ?? (async () => ({ kind: 'other' })),
  };
  const controller = new DockAnnotationController(host, native);
  const events: DockEvidenceNativeEvent[] = [];
  const issues: DockAnnotationIssue[] = [];
  controller.subscribe((event) => events.push(event));
  controller.onIssue((issue) => issues.push(issue));

  async function start(
    mode: 'live' | 'still' | 'dictation' = 'live',
    tool: DockMarkTool = 'box',
    id = 's1',
    still?: unknown,
  ) {
    const pending = controller.startAnnotation({
      id,
      tool,
      mode,
      ...(still ? { still } : {}),
    } as never);
    await Promise.resolve();
    expect(controller.isActive()).toBe(false);
    controller.handleReady({ sessionId: id });
    return pending;
  }
  let sequence = 0;
  async function gesture(
    points: { x: number; y: number }[],
    tool: DockMarkTool = 'box',
    id = 's1',
  ) {
    sequence += 1;
    const down = controller.handlePointer({
      sessionId: id,
      sequence,
      phase: 'down',
      ...points[0]!,
      tool,
    });
    if (!down.ok) return down;
    return controller.handleGesture({ sessionId: id, sequence, tool, origin: points[0]!, points });
  }
  return {
    expire: (ms: number) =>
      timers.filter((timer) => timer.ms === ms).forEach((timer) => timer.callback()),
    clock,
    started,
    settled,
    io,
    issues,
    controller,
    host,
    events,
    windows,
    captures,
    cursor,
    tick: () => intervals.forEach((callback) => callback()),
    start,
    gesture,
    holdCaptures: () => (holdCaptures = true),
    releaseCapture: () => resolveCapture?.(),
    nextSequence: () => ++sequence,
  };
}

const marks = (events: DockEvidenceNativeEvent[]) =>
  events.filter(
    (event): event is Extract<DockEvidenceNativeEvent, { type: 'mark' }> => event.type === 'mark',
  );

describe('DockAnnotationController', () => {
  it.each([false, true])(
    'retires active or warm resources and preserves subscribers (ended=%s)',
    async (ended) => {
      const t = setup();
      const stopNavigation = vi.fn();
      t.host.watchNavigation = vi.fn(() => stopNavigation);
      await t.start();
      expect(t.host.watchNavigation).toHaveBeenCalledTimes(1);
      if (ended) await t.controller.endAnnotation('s1');
      t.controller.retireResources();
      expect(t.windows[0]!.destroyed).toBe(true);
      expect(stopNavigation).toHaveBeenCalledTimes(1);
      await t.start('live', 'box', 's2');
      expect(t.host.watchNavigation).toHaveBeenCalledTimes(2);
      await expect(
        t.gesture(
          [
            { x: 100, y: 50 },
            { x: 300, y: 150 },
          ],
          'box',
          's2',
        ),
      ).resolves.toEqual({ ok: true });
      expect(marks(t.events).length).toBeGreaterThan(0);
    },
  );

  it('resolves start only after the overlay painted the session, then shows inactive', async () => {
    const t = setup();
    await expect(t.start()).resolves.toEqual({ ok: true, value: undefined });
    expect(t.controller.isActive()).toBe(true);
    expect(t.windows[0]!.shown).toBe(1);
    expect(t.controller.overlayWindowIds()).toEqual([4242]);
  });

  it('stamps the overlay with the dock backend and never reuses it across backends', async () => {
    const t = setup();
    await t.start();
    expect(t.windows.map((window) => window.backendId)).toEqual(['remote-1']);
    await t.controller.endAnnotation('s1');
    t.host.backend = 'remote-2';
    await t.start('live', 'box', 's2');
    expect(t.windows.map((window) => [window.backendId, window.destroyed])).toEqual([
      ['remote-1', true],
      ['remote-2', false],
    ]);
    t.host.backend = null;
    await expect(
      t.controller.startAnnotation({ id: 's3', tool: 'box', mode: 'live' }),
    ).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('never shows the overlay before live recordings acknowledge excluding it', async () => {
    const t = setup();
    let ack: (ok: boolean) => void = () => {};
    const asked: number[] = [];
    const announced: number[][] = [];
    t.controller.onOverlayWindowsChanged((ids) => announced.push(ids));
    t.host.beforeOverlayShow = (id) => {
      asked.push(id);
      return new Promise<boolean>((resolve) => (ack = resolve));
    };
    const started = t.start();
    await vi.waitFor(() => expect(asked).toEqual([4242]));
    const window = t.windows[0]!;
    // Delayed ACK: still hidden, inactive, but its id is reported so a clip starting now excludes it.
    expect([window.shown, window.visible, t.controller.isActive()]).toEqual([0, false, false]);
    expect(t.controller.overlayWindowIds()).toEqual([4242]);
    expect(announced).toEqual([[4242]]);
    ack(true);
    await expect(started).resolves.toEqual({ ok: true, value: undefined });
    expect(window.shown).toBe(1);

    await t.controller.endAnnotation('s1');
    t.host.beforeOverlayShow = () => false;
    await expect(t.start('live', 'box', 's2')).resolves.toEqual({
      ok: false,
      error: 'failed',
      detail: 'recording-exclusion',
    });
    expect([window.shown, window.visible]).toEqual([1, false]);
    expect(t.controller.overlayWindowIds()).toEqual([]);
  });

  it('a replaced start resolving late never releases its successor exclusion reservation', async () => {
    const t = setup();
    const acks: Record<number, (ok: boolean) => void> = {};
    let calls = 0;
    const announced: number[][] = [];
    t.controller.onOverlayWindowsChanged((ids) => announced.push(ids));
    t.host.beforeOverlayShow = () => new Promise<boolean>((resolve) => (acks[++calls] = resolve));
    const first = t.start('live', 'box', 'A');
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = t.start('live', 'box', 'B');
    await vi.waitFor(() => expect(calls).toBe(2));
    // A acknowledges last-but-one, while B's barrier is still pending.
    acks[1]!(true);
    await expect(first).resolves.toEqual({ ok: false, error: 'unavailable' });
    expect(t.controller.overlayWindowIds()).toEqual([4242]);
    expect(announced.at(-1)).toEqual([4242]);
    expect(t.windows[0]!.shown).toBe(0);
    acks[2]!(true);
    await expect(second).resolves.toEqual({ ok: true, value: undefined });
    expect(t.windows[0]!.shown).toBe(1);
    expect(t.controller.overlayWindowIds()).toEqual([4242]);
  });

  it('first live mark carries the capture in image pixels on a negative-origin Retina display', async () => {
    const t = setup();
    await t.start();
    await expect(
      t.gesture([
        { x: 100, y: 50 },
        { x: 300, y: 150 },
      ]),
    ).resolves.toEqual({ ok: true });
    const [mark] = marks(t.events);
    expect(mark!.geometry).toEqual({ kind: 'rect', x: 200, y: 100, w: 400, h: 200 });
    expect(mark!.capture).toMatchObject({
      width: 2880,
      height: 1800,
      displayScale: 2,
      hash: SAME_HASH,
    });
    // Dock, its popups and the overlay itself are excluded from the clean capture.
    expect(t.captures[0]!.excluded).toEqual([11, 12, 4242]);
  });

  it('keeps the actual capture scale and time when the capture was size-capped', async () => {
    const t = setup();
    await t.start();
    t.io.shot = {
      width: 2160,
      height: 1350,
      displayScale: 1.5,
      capturedAt: '2026-10-29T18:00:00Z',
    };
    await t.gesture([
      { x: 100, y: 50 },
      { x: 300, y: 150 },
    ]);
    expect(marks(t.events)[0]).toMatchObject({
      geometry: { kind: 'rect', x: 150, y: 75, w: 300, h: 150 },
      capture: { width: 2160, height: 1350, displayScale: 1.5, capturedAt: '2026-10-29T18:00:00Z' },
    });
  });

  it('reuses the session image within the hash threshold and starts a new one beyond it', async () => {
    const t = setup({ hashes: [SAME_HASH, NEAR_HASH, FAR_HASH, VERY_FAR_HASH, VERY_FAR_HASH] });
    await t.start();
    await t.gesture([
      { x: 10, y: 10 },
      { x: 60, y: 60 },
    ]);
    await t.gesture([
      { x: 10, y: 10 },
      { x: 60, y: 60 },
    ]);
    await t.gesture([
      { x: 10, y: 10 },
      { x: 60, y: 60 },
    ]);
    await t.gesture([
      { x: 10, y: 10 },
      { x: 60, y: 60 },
    ]);
    expect(marks(t.events).map((mark) => !!mark.capture)).toEqual([true, false, false, true]);
    // Same pixels, but the app navigated: the next mark still starts a new image.
    t.controller.notifyNavigation();
    await t.gesture([
      { x: 10, y: 10 },
      { x: 60, y: 60 },
    ]);
    expect(marks(t.events).at(-1)!.capture).toBeDefined();
  });

  it('freezes the gesture before the capture await and drops it if the session ends', async () => {
    const t = setup();
    await t.start();
    t.host.clip = 9400;
    t.holdCaptures();
    const pending = t.gesture([
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    ]);
    // The id and clocks are stamped at the accepted pointerdown, before any await.
    expect(t.started).toEqual(['s1/mark-1']);
    t.clock.now += 5_000;
    await vi.waitFor(() => expect(t.captures).toHaveLength(1));
    // Tool and clip changes after pointerup do not leak into the frozen mark.
    await t.controller.setAnnotationTool('s1', 'arrow');
    t.host.clip = 20_000;
    t.releaseCapture();
    await pending;
    expect(marks(t.events)[0]).toMatchObject({
      tool: 'box',
      clipMs: 9400,
      markId: 'mark-1',
      gestureAtEpochMs: Date.parse('2026-10-29T18:12:04Z'),
    });

    const second = t.gesture(
      [
        { x: 10, y: 10 },
        { x: 80, y: 80 },
      ],
      'arrow',
    );
    await vi.waitFor(() => expect(t.captures).toHaveLength(2));
    await t.controller.endAnnotation('s1');
    t.releaseCapture();
    await expect(second).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(marks(t.events)).toHaveLength(1);
  });

  it('settles every started gesture exactly once: committed after its mark, else rejected or cancelled', async () => {
    const t = setup();
    await t.start();
    t.events.length = 0;
    t.controller.subscribe((event) => {
      if (event.type === 'mark') t.settled.push(`event:${event.markId}`);
    });
    await t.gesture([
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    ]);
    t.io.captureError = 'permission';
    await t.gesture([
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    ]);
    const sequence = t.nextSequence();
    t.controller.handlePointer({
      sessionId: 's1',
      sequence,
      phase: 'down',
      x: 10,
      y: 10,
      tool: 'box',
    });
    t.controller.handlePointer({
      sessionId: 's1',
      sequence,
      phase: 'cancel',
      x: 10,
      y: 10,
      tool: 'box',
    });
    t.controller.handlePointer({
      sessionId: 's1',
      sequence: t.nextSequence(),
      phase: 'down',
      x: 10,
      y: 10,
      tool: 'box',
    });
    await t.controller.endAnnotation('s1');
    expect(t.started).toEqual(['s1/mark-1', 's1/mark-2', 's1/mark-3', 's1/mark-4']);
    expect(t.settled).toEqual([
      'event:mark-1',
      's1/mark-1:committed',
      's1/mark-2:rejected',
      's1/mark-3:cancelled',
      's1/mark-4:cancelled',
    ]);
  });

  it('a hung capture is rejected at the commit deadline and its late result never emits', async () => {
    const t = setup();
    await t.start();
    t.holdCaptures();
    const pending = t.gesture([
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    ]);
    await vi.waitFor(() => expect(t.captures).toHaveLength(1));
    t.expire(10_000);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'failed' });
    t.releaseCapture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.events).toEqual([]);
    expect(t.settled).toEqual(['s1/mark-1:rejected']);
    // The late capture installed no session image: the next mark still carries one.
    const next = t.gesture([
      { x: 10, y: 10 },
      { x: 80, y: 80 },
    ]);
    await vi.waitFor(() => expect(t.captures).toHaveLength(2));
    t.releaseCapture();
    await expect(next).resolves.toEqual({ ok: true });
    expect(marks(t.events)[0]!.capture).toBeDefined();
  });

  it('never starts gestures on the dock, outside the display, or outside an app window', async () => {
    // The app window ends at global x = -540; right of it is desktop.
    const narrow = {
      ...noHit,
      window: { ...appWindow, bounds: { ...appWindow.bounds, width: 900 } },
    };
    const t = setup({ hit: (point) => (point.x > -540 ? { ...noHit, window: null } : narrow) });
    await t.start();
    // Dock column: overlay-local x >= 1140.
    expect(
      await t.gesture([
        { x: 1200, y: 10 },
        { x: 1300, y: 90 },
      ]),
    ).toEqual({ ok: false, reason: 'excluded' });
    expect(
      await t.gesture([
        { x: 1500, y: 10 },
        { x: 1600, y: 90 },
      ]),
    ).toEqual({ ok: false, reason: 'outside' });
    // Desktop / menu bar at the origin (no app window under it).
    expect(
      await t.gesture([
        { x: 1000, y: 10 },
        { x: 1100, y: 90 },
      ]),
    ).toEqual({ ok: false, reason: 'outside' });
    // A shape that leaves the target app window.
    expect(
      await t.gesture([
        { x: 800, y: 10 },
        { x: 1000, y: 90 },
      ]),
    ).toEqual({ ok: false, reason: 'outside' });
    expect(t.events).toEqual([]);
    expect(t.captures).toEqual([]);
  });

  it('fences stale sequences, mismatched origins and replaced sessions', async () => {
    const t = setup();
    await t.start();
    const sequence = t.nextSequence();
    expect(
      t.controller.handlePointer({
        sessionId: 's1',
        sequence,
        phase: 'down',
        x: 10,
        y: 10,
        tool: 'box',
      }).ok,
    ).toBe(true);
    // Replayed pointerdown.
    expect(
      t.controller.handlePointer({
        sessionId: 's1',
        sequence,
        phase: 'down',
        x: 10,
        y: 10,
        tool: 'box',
      }),
    ).toEqual({ ok: false, reason: 'stale' });
    // Origin moved between pointerdown and commit.
    expect(
      await t.controller.handleGesture({
        sessionId: 's1',
        sequence,
        tool: 'box',
        origin: { x: 40, y: 40 },
        points: [
          { x: 40, y: 40 },
          { x: 90, y: 90 },
        ],
      }),
    ).toEqual({ ok: false, reason: 'stale' });

    const held = t.nextSequence();
    t.controller.handlePointer({
      sessionId: 's1',
      sequence: held,
      phase: 'down',
      x: 10,
      y: 10,
      tool: 'box',
    });
    await t.start('live', 'box', 's2');
    expect(
      await t.controller.handleGesture({
        sessionId: 's1',
        sequence: held,
        tool: 'box',
        origin: { x: 10, y: 10 },
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 90 },
        ],
      }),
    ).toEqual({ ok: false, reason: 'stale' });
    expect(t.events).toEqual([]);
  });

  it('still markup maps into the frozen pixels, never captures, and refuses picks', async () => {
    const t = setup();
    const still = {
      imageId: 'img-1',
      pixels: {
        base64: 'AAAA',
        mimeType: 'image/png',
        width: 1200,
        height: 900,
        displayScale: 2,
        capturedAt: 'x',
      },
    };
    await t.start('still', 'pick', 's1', still);
    // A frozen image has no live element: pick is refused, not faked.
    expect(await t.gesture([{ x: 220, y: 100 }], 'pick')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(t.issues).toEqual([{ sessionId: 's1', kind: 'pick', error: 'unavailable' }]);
    await t.controller.setAnnotationTool('s1', 'box');
    // 1200×900 contained in 1440×900 → scale 1, offset x 120.
    await t.gesture(
      [
        { x: 120, y: 0 },
        { x: 220, y: 50 },
      ],
      'box',
    );
    expect(t.captures).toEqual([]);
    expect(
      marks(t.events).map(({ geometry, element, capture }) => ({ geometry, element, capture })),
    ).toEqual([
      { geometry: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, element: null, capture: undefined },
    ]);
    expect(t.controller.handleStill({ sessionId: 's1' })).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
    });
  });

  it('pick reports the actual accessibility role, name and frame with no invented path or source', async () => {
    const element = {
      role: 'AXButton',
      name: 'Get started',
      rect: { x: -1340, y: -50, width: 112, height: 36 },
    };
    const t = setup({ hit: () => ({ ...noHit, element }) });
    await t.start('dictation', 'pick');
    await t.gesture([{ x: 120, y: 60 }], 'pick');
    expect(marks(t.events)[0]).toMatchObject({
      tool: 'pick',
      geometry: { kind: 'rect', x: 200, y: 100, w: 224, h: 72 },
      element: { role: 'button', name: 'Get started', path: null, source: null },
    });
  });

  it("picks in Intent's main window from its page, but has nothing to pick in its browser panel", async () => {
    const requests: unknown[] = [];
    let answer: Awaited<ReturnType<DockAnnotationNative['intentWindow']>> = {
      kind: 'intent',
      inPanel: false,
      element: {
        role: 'button',
        name: 'Save',
        path: 'main > button#save',
        rect: { x: -1340, y: -50, width: 112, height: 36 },
      },
    };
    // Accessibility is irrelevant on Intent's own page.
    const t = setup({
      hit: () => ({ ...noHit, access: 'permission', element: null }),
      intent: async (windowId, request) => {
        requests.push({ windowId, ...request });
        return answer;
      },
    });
    await t.start('dictation', 'pick');
    expect(await t.gesture([{ x: 120, y: 60 }], 'pick')).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({
      windowId: appWindow.windowId,
      elementPoint: { x: -1320, y: -40 },
    });
    expect(marks(t.events)[0]).toMatchObject({
      element: { role: 'button', name: 'Save', path: 'main > button#save', source: null },
    });
    answer = { kind: 'intent', inPanel: true, element: null };
    expect(await t.gesture([{ x: 120, y: 60 }], 'pick')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    answer = { kind: 'failed' };
    expect(await t.gesture([{ x: 120, y: 60 }], 'pick')).toEqual({ ok: false, reason: 'failed' });
    expect(t.captures).toHaveLength(1);
    expect(marks(t.events)).toHaveLength(1);
  });

  it('a pick without accessibility leaves images and marks unchanged and reports why', async () => {
    let hit: DockElementHit = { ...noHit, access: 'permission', element: null };
    const t = setup({ hit: () => hit });
    await t.start('live', 'pick');
    expect(await t.gesture([{ x: 120, y: 60 }], 'pick')).toEqual({
      ok: false,
      reason: 'permission',
    });
    hit = { ...noHit, access: 'granted', element: null };
    expect(await t.gesture([{ x: 120, y: 60 }], 'pick')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    hit = { checked: false, access: 'unavailable', window: null, element: null };
    expect(await t.gesture([{ x: 120, y: 60 }], 'pick')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(t.captures).toEqual([]);
    expect(t.events).toEqual([]);
    expect(t.issues.map(({ kind, error }) => `${kind}:${error}`)).toEqual([
      'pick:permission',
      'pick:unavailable',
      'target:unavailable',
    ]);
    // Shapes stay usable without accessibility.
    hit = { ...noHit, access: 'permission', element: null };
    await t.controller.setAnnotationTool('s1', 'pen');
    expect(
      await t.gesture(
        [
          { x: 10, y: 10 },
          { x: 40, y: 30 },
          { x: 80, y: 20 },
        ],
        'pen',
      ),
    ).toEqual({ ok: true });
  });

  it('screen-recording denial at capture makes no mark and reports the capture issue', async () => {
    const t = setup();
    await t.start();
    t.io.captureError = 'permission';
    expect(
      await t.gesture([
        { x: 10, y: 10 },
        { x: 80, y: 80 },
      ]),
    ).toEqual({ ok: false, reason: 'permission' });
    expect(t.events).toEqual([]);
    expect(t.issues).toEqual([{ sessionId: 's1', kind: 'capture', error: 'permission' }]);
  });

  it('rejects a late capture after the target window moved, and a wrong-frame capture', async () => {
    const t = setup();
    await t.start();
    t.io.onCaptured = () => {
      t.io.hit = () => ({
        ...noHit,
        window: { ...appWindow, bounds: { ...appWindow.bounds, y: -60 } },
      });
    };
    expect(
      await t.gesture([
        { x: 10, y: 10 },
        { x: 80, y: 80 },
      ]),
    ).toEqual({ ok: false, reason: 'stale' });
    t.io.onCaptured = () => {};
    t.io.hit = () => noHit;
    t.io.shot = { width: 2880, height: 1620 }; // 16:9 frame for a 16:10 display
    expect(
      await t.gesture([
        { x: 10, y: 10 },
        { x: 80, y: 80 },
      ]),
    ).toEqual({ ok: false, reason: 'failed' });
    expect(t.events).toEqual([]);
  });

  it('drops a mark whose capture finished after the dock moved to another display', async () => {
    const t = setup();
    await t.start();
    t.io.onCaptured = () => {
      t.host.display = { ...DISPLAY, id: 8, bounds: { ...DISPLAY.bounds, x: 0, y: 0 } } as Display;
    };
    expect(
      await t.gesture([
        { x: 10, y: 10 },
        { x: 80, y: 80 },
      ]),
    ).toEqual({ ok: false, reason: 'stale' });
    expect(t.events).toEqual([]);
  });

  it('routes the pointer through over the dock unless a gesture is held', async () => {
    const t = setup();
    await t.start();
    const window = t.windows[0]!;
    t.cursor.x = -100; // over the dock column
    t.tick();
    expect(window.ignore.at(-1)).toBe(true);
    t.cursor.x = -1000;
    t.tick();
    expect(window.ignore.at(-1)).toBe(false);
    t.controller.handlePointer({
      sessionId: 's1',
      sequence: t.nextSequence(),
      phase: 'down',
      x: 10,
      y: 10,
      tool: 'box',
    });
    t.cursor.x = -100;
    t.tick();
    expect(window.ignore.at(-1)).toBe(false);
  });

  it('ends the session and tells the dock when the dock display goes away', async () => {
    const t = setup();
    await t.start();
    t.host.display = null;
    t.tick();
    expect(t.controller.isActive()).toBe(false);
    expect(t.events).toEqual([{ type: 'annotation-ended', sessionId: 's1' }]);
    expect(t.windows[0]!.webContents.sent.at(-1)).toBeNull();
    // The hidden, retained overlay is no longer reported for exclusion.
    expect(t.controller.overlayWindowIds()).toEqual([]);
  });

  it('redraws exactly the authoritative marks after undo', async () => {
    const t = setup();
    await t.start();
    const geometry = { kind: 'rect' as const, x: 0, y: 0, w: 10, h: 10 };
    await t.controller.syncMarks('s1', [
      { n: 1, tool: 'box', geometry },
      { n: 2, tool: 'box', geometry },
    ]);
    await t.controller.syncMarks('s1', [{ n: 1, tool: 'box', geometry }]);
    const last = t.windows[0]!.webContents.sent.at(-1) as {
      marks: unknown[];
      marksRevision: number;
    };
    expect(last.marks).toEqual([{ n: 1, tool: 'box', geometry }]);
    expect(last.marksRevision).toBe(2);
  });
});

describe('watchDockNavigation', () => {
  it('reports top-level and route navigations of the reviewed screen, never subframes or own surfaces', () => {
    const contents = new EventEmitter();
    let own = false;
    const notify = vi.fn();
    const stop = watchDockNavigation(
      contents as unknown as Electron.WebContents,
      () => own,
      notify,
    );
    contents.emit('did-navigate', {}, 'https://app.test/next');
    contents.emit('did-navigate-in-page', {}, 'https://app.test/#route', true);
    expect(notify).toHaveBeenCalledTimes(2);
    contents.emit('did-navigate-in-page', {}, 'https://ads.test/frame', false);
    own = true;
    contents.emit('did-navigate', {}, 'app://workspaces/dock');
    contents.emit('did-navigate-in-page', {}, 'app://workspaces/dock#x', true);
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
    expect(contents.listenerCount('did-navigate')).toBe(0);
    expect(contents.listenerCount('did-navigate-in-page')).toBe(0);
  });
});

describe('DockAnnotationController on-screen tool bar and start refusals', () => {
  it('names why a start was refused so the dock can say it', async () => {
    const t = setup();
    t.host.display = null;
    await expect(
      t.controller.startAnnotation({ id: 's2', tool: 'box', mode: 'live' }),
    ).resolves.toEqual({ ok: false, error: 'unavailable', detail: 'display' });
    t.host.display = DISPLAY;
    // The overlay never painted: a timeout, not a replacement.
    const pending = t.controller.startAnnotation({ id: 's3', tool: 'box', mode: 'live' });
    await Promise.resolve();
    t.expire(5_000);
    await expect(pending).resolves.toEqual({
      ok: false,
      error: 'unavailable',
      detail: 'overlay-timeout',
    });
    // A start replaced meanwhile is plain unavailable (the dock stays silent for it).
    const replaced = t.controller.startAnnotation({ id: 's4', tool: 'box', mode: 'live' });
    await Promise.resolve();
    await t.controller.endAnnotation('s4');
    await expect(replaced).resolves.toEqual({ ok: false, error: 'unavailable' });
  });

  it('publishes the work area, switches tools and ends from the bar, and never starts a mark on it', async () => {
    const t = setup();
    t.host.display = {
      ...DISPLAY,
      workArea: { x: -1440, y: -75, width: 1440, height: 805 },
    } as Display;
    // The dock's painted shell (global DIP) on the overlay's display.
    let anchor = {
      shape: 'notch' as const,
      rect: { x: -1440 + 520, y: -100, width: 400, height: 60 },
    };
    t.host.dockAnchor = () => anchor;
    await t.start('live', 'box');
    const state = t.windows[0]!.webContents.sent.at(-1) as {
      displayId: number;
      workArea: unknown;
      dock: unknown;
    };
    expect(state.displayId).toBe(7);
    expect(state.workArea).toEqual({ x: 0, y: 25, width: 1440, height: 805 });
    expect(state.dock).toEqual({
      shape: 'notch',
      rect: { x: 520, y: 0, width: 400, height: 60 },
    });
    // The dock expands or moves: the overlay is republished so the bar follows it.
    anchor = {
      shape: 'edge' as const,
      side: 'right',
      rect: { x: -1440 + 1384, y: 100, width: 56, height: 400 },
    } as never;
    const published = t.windows[0]!.webContents.sent.length;
    t.tick();
    expect(t.windows[0]!.webContents.sent.length).toBe(published + 1);
    expect((t.windows[0]!.webContents.sent.at(-1) as { dock: unknown }).dock).toEqual({
      shape: 'edge',
      side: 'right',
      rect: { x: 1384, y: 200, width: 56, height: 400 },
    });
    t.tick();
    expect(t.windows[0]!.webContents.sent.length).toBe(published + 1);

    // A stale or foreign session is refused.
    expect(t.controller.handleToolbar({ sessionId: 'other', action: 'end' })).toBe(false);
    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'tool', tool: 'pen' })).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'annotation-tool', sessionId: 's1', tool: 'pen' });
    expect((t.windows[0]!.webContents.sent.at(-1) as { tool: string }).tool).toBe('pen');

    // The bar's rect is clickable even over the dock column, and never a gesture origin.
    const bar = { x: 600, y: 760, width: 173, height: 38 };
    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'rect', rect: bar })).toBe(true);
    expect(await t.gesture([{ x: 650, y: 770 }], 'pen')).toEqual({
      ok: false,
      reason: 'excluded',
    });
    // Over the dock column the overlay lets clicks through, except on the bar.
    t.cursor.x = -1440 + 1250;
    t.cursor.y = -100 + 700;
    t.tick();
    expect(t.windows[0]!.ignore.at(-1)).toBe(true);
    t.controller.handleToolbar({
      sessionId: 's1',
      action: 'rect',
      rect: { ...bar, x: 1200, y: 680 },
    });
    t.tick();
    expect(t.windows[0]!.ignore.at(-1)).toBe(false);
    expect(marks(t.events)).toEqual([]);

    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'end' })).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'annotation-ended', sessionId: 's1' });
    expect(t.controller.isActive()).toBe(false);
  });

  it('mouse mode makes the overlay click-through except its bar, makes no marks, and a tool resumes', async () => {
    const t = setup();
    await t.start('live', 'box');
    const bar = { x: 600, y: 760, width: 200, height: 38 };
    t.controller.handleToolbar({ sessionId: 's1', action: 'rect', rect: bar });
    // Over the page, annotating takes the click.
    t.cursor.x = -1440 + 300;
    t.cursor.y = -100 + 300;
    t.tick();
    expect(t.windows[0]!.ignore.at(-1)).toBe(false);

    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'mouse' })).toBe(true);
    expect((t.windows[0]!.webContents.sent.at(-1) as { mouse: boolean }).mouse).toBe(true);
    t.tick();
    expect(t.windows[0]!.ignore.at(-1)).toBe(true);
    expect(
      await t.gesture(
        [
          { x: 300, y: 300 },
          { x: 360, y: 340 },
        ],
        'box',
      ),
    ).toEqual({
      ok: false,
      reason: 'excluded',
    });
    // The bar itself stays clickable in mouse mode.
    t.cursor.x = -1440 + 650;
    t.cursor.y = -100 + 770;
    t.tick();
    expect(t.windows[0]!.ignore.at(-1)).toBe(false);
    // Mouse mode is not a tool: the dock is not told to change its saved tool.
    expect(t.events.filter((event) => event.type === 'annotation-tool')).toEqual([]);

    // A tool from the dock (keys 1-4) resumes annotating, and marks are made again.
    await t.controller.setAnnotationTool('s1', 'box');
    expect((t.windows[0]!.webContents.sent.at(-1) as { mouse: boolean }).mouse).toBe(false);
    t.cursor.x = -1440 + 300;
    t.cursor.y = -100 + 300;
    t.tick();
    expect(t.windows[0]!.ignore.at(-1)).toBe(false);
    await t.controller.setAnnotationMouse('s1');
    expect((t.windows[0]!.webContents.sent.at(-1) as { mouse: boolean }).mouse).toBe(true);
    t.controller.handleToolbar({ sessionId: 's1', action: 'tool', tool: 'pen' });
    expect((t.windows[0]!.webContents.sent.at(-1) as { mouse: boolean }).mouse).toBe(false);
  });

  it('never drops a drawn mark silently: a failed capture tells the dock', async () => {
    const t = setup();
    await t.start('live', 'box');
    t.io.captureError = 'failed' as never;
    expect(
      await t.gesture(
        [
          { x: 100, y: 100 },
          { x: 200, y: 180 },
        ],
        'box',
      ),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(t.issues.map(({ kind, error }) => `${kind}:${error}`)).toEqual(['capture:unavailable']);
    expect(marks(t.events)).toEqual([]);
  });

  it('Screenshot and Record on the bar go to the dock and leave the session as it is; their state is validated and shown', async () => {
    const t = setup();
    await t.start('live', 'box');
    const media = {
      capture: {
        label: 'Capture',
        tooltip: 'Capture',
        disabled: false,
        pending: false,
        alert: false,
      },
      record: {
        label: 'Stop recording',
        tooltip: 'Stop recording',
        disabled: false,
        pending: false,
        alert: false,
        recording: true,
        startedAt: 1_700_000_000_000,
      },
    };
    const sent = () =>
      t.windows[0]!.webContents.sent.at(-1) as { media: unknown; tool: string; mouse: boolean };
    expect(sent().media).toBeNull();
    t.controller.setAnnotationMedia(media);
    expect(sent().media).toEqual(media);
    // Malformed state is refused, never published: the last good one stays.
    for (const bad of [
      null,
      { capture: media.capture },
      { ...media, record: { ...media.record, startedAt: Number.NaN } },
      { ...media, capture: { ...media.capture, tooltip: 'x'.repeat(201) } },
      { ...media, record: { ...media.record, recording: 'yes' } },
    ]) {
      t.controller.setAnnotationMedia(bad);
      expect(sent().media).toEqual(media);
    }
    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'capture' })).toBe(true);
    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'record' })).toBe(true);
    expect(t.events.slice(-2)).toEqual([
      { type: 'annotation-media', sessionId: 's1', action: 'capture' },
      { type: 'annotation-media', sessionId: 's1', action: 'record' },
    ]);
    // A stale session's click is refused.
    expect(t.controller.handleToolbar({ sessionId: 'other', action: 'record' })).toBe(false);
    expect(t.controller.isActive()).toBe(true);
    expect(sent().tool).toBe('box');
    expect(sent().mouse).toBe(false);
  });

  it('Clear empties the screen without attaching and keeps the tool (no mouse mode)', async () => {
    const t = setup();
    await t.start('live', 'box');
    expect(
      await t.gesture(
        [
          { x: 100, y: 100 },
          { x: 200, y: 180 },
        ],
        'box',
      ),
    ).toEqual({ ok: true });
    await t.controller.syncMarks('s1', [
      { n: 1, tool: 'box', geometry: { kind: 'rect', x: 1, y: 1, w: 10, h: 10 } },
    ]);
    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'clear' })).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'annotation-clear', sessionId: 's1' });
    const state = t.windows[0]!.webContents.sent.at(-1) as {
      marks: unknown[];
      image: unknown;
      mouse: boolean;
      tool: string;
    };
    expect(state.marks).toEqual([]);
    expect(state.image).toBeNull();
    expect(state.mouse).toBe(false);
    expect(state.tool).toBe('box');
    // Still annotating: the next mark captures a new image.
    expect(
      await t.gesture(
        [
          { x: 300, y: 300 },
          { x: 380, y: 360 },
        ],
        'box',
      ),
    ).toEqual({ ok: true });
    expect(marks(t.events).at(-1)?.capture).toBeDefined();
  });

  it('Done clears the screen and starts a new image while the session stays open', async () => {
    const t = setup();
    await t.start('live', 'box');
    expect(
      await t.gesture(
        [
          { x: 100, y: 100 },
          { x: 200, y: 180 },
        ],
        'box',
      ),
    ).toEqual({ ok: true });
    await t.controller.syncMarks('s1', [
      { n: 1, tool: 'box', geometry: { kind: 'rect', x: 1, y: 1, w: 10, h: 10 } },
    ]);
    expect(t.controller.handleToolbar({ sessionId: 's1', action: 'commit' })).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'annotation-commit', sessionId: 's1' });
    const state = t.windows[0]!.webContents.sent.at(-1) as { marks: unknown[]; image: unknown };
    expect(state.marks).toEqual([]);
    expect(state.image).toBeNull();
    expect(t.controller.isActive()).toBe(true);
    // Done then goes to mouse mode: no gesture until a tool is chosen again.
    expect((state as unknown as { mouse: boolean }).mouse).toBe(true);
    expect(
      await t.gesture(
        [
          { x: 300, y: 300 },
          { x: 380, y: 360 },
        ],
        'box',
      ),
    ).toEqual({
      ok: false,
      reason: 'excluded',
    });
    await t.controller.setAnnotationTool('s1', 'box');
    // The next mark captures a new image.
    expect(
      await t.gesture(
        [
          { x: 300, y: 300 },
          { x: 380, y: 360 },
        ],
        'box',
      ),
    ).toEqual({ ok: true });
    expect(marks(t.events).at(-1)?.capture).toBeDefined();
  });

  it('reports annotating activity (gestures, tool bar clicks) so live dictation is not ended by silence', async () => {
    const t = setup();
    const activity = vi.fn();
    t.host.onActivity = activity;
    await t.start('live', 'box');
    t.controller.handleToolbar({
      sessionId: 's1',
      action: 'rect',
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(activity).not.toHaveBeenCalled();
    t.controller.handleToolbar({ sessionId: 's1', action: 'mouse' });
    t.controller.handleToolbar({ sessionId: 's1', action: 'tool', tool: 'box' });
    expect(activity).toHaveBeenCalledTimes(2);
    await t.gesture(
      [
        { x: 100, y: 100 },
        { x: 200, y: 180 },
      ],
      'box',
    );
    expect(activity).toHaveBeenCalledTimes(3);
    // X ends the annotate session only; it reports activity like any bar click.
    t.controller.handleToolbar({ sessionId: 's1', action: 'end' });
    expect(activity).toHaveBeenCalledTimes(4);
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  inspect: vi.fn(),
  supportsCustom: undefined as boolean | undefined,
}));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('node:module', () => ({ createRequire: () => () => fixture }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/fixture' } }));
vi.mock('../shared/logger', () => ({
  Logger: class {
    warn() {}
  },
}));

import { attachDockCursor } from './dock-cursor';

const state = {
  regions: [{ x: -4, y: 16, width: 420, height: 300 }],
  excludedRegions: [{ x: 100, y: 16, width: 80, height: 24 }],
  revision: 17,
  enabled: true,
};
function windowFixture() {
  return { getNativeWindowHandle: () => Buffer.alloc(8), focus: vi.fn(), show: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.update.mockReset();
  fixture.create.mockReturnValue({ token: 'native' });
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
});
afterEach(() => vi.unstubAllGlobals());

describe('dock native cursor contract', () => {
  it.each([
    ['n-resize', 'ns-resize'],
    ['s-resize', 'ns-resize'],
    ['ns-resize', 'ns-resize'],
    ['e-resize', 'ew-resize'],
    ['w-resize', 'ew-resize'],
    ['ew-resize', 'ew-resize'],
    ['ne-resize', 'nesw-resize'],
    ['sw-resize', 'nesw-resize'],
    ['nesw-resize', 'nesw-resize'],
    ['nw-resize', 'nwse-resize'],
    ['se-resize', 'nwse-resize'],
    ['nwse-resize', 'nwse-resize'],
    ['grab', 'grab'],
    ['grabbing', 'grabbing'],
  ])('passes %s as %s without altering accepted geometry or activating the dock', (input, kind) => {
    const window = windowFixture();
    const controller = attachDockCursor(window as unknown as BrowserWindow)!;
    controller.update(state);
    fixture.update.mockClear();
    controller.cursorChanged(input);
    expect(fixture.update).toHaveBeenCalledTimes(1);
    expect(fixture.update).toHaveBeenLastCalledWith({ token: 'native' }, { ...state, kind });
    controller.cursorChanged(input);
    expect(fixture.update).toHaveBeenCalledTimes(1);
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('retains exclusions/revision and disables resize ownership on capture without redundant writes', () => {
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    controller.cursorChanged('nwse-resize');
    const hidden = { ...state, enabled: false, regions: [], revision: 18 };
    controller.update(hidden);
    expect(fixture.update).toHaveBeenLastCalledWith(
      { token: 'native' },
      { ...hidden, kind: 'nwse-resize' },
    );
    const calls = fixture.update.mock.calls.length;
    controller.update(hidden);
    controller.cursorChanged('se-resize');
    expect(fixture.update).toHaveBeenCalledTimes(calls);
    controller.update({ ...state, revision: 19 });
    expect(fixture.update).toHaveBeenLastCalledWith(
      { token: 'native' },
      { ...state, revision: 19, kind: 'nwse-resize' },
    );
    controller.dispose();
  });

  it.each([
    ['pointer', 'pointer'],
    ['hand', 'pointer'],
    ['text', 'text'],
  ] as const)('owns the %s cursor as %s while the dock is not key', (input, kind) => {
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    controller.cursorChanged(input);
    expect(fixture.update).toHaveBeenLastCalledWith({ token: 'native' }, { ...state, kind });
    controller.dispose();
  });

  it.each(['default', 'custom', 'ns-no-resize', 'col-resize', 'row-resize'])(
    'releases ownership for %s instead of inventing a resize cursor',
    (input) => {
      const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
      controller.update(state);
      controller.cursorChanged('ew-resize');
      controller.cursorChanged(input);
      expect(fixture.update).toHaveBeenLastCalledWith(
        { token: 'native' },
        { ...state, kind: 'none' },
      );
      controller.dispose();
    },
  );

  it('retries a failed native update and stops writes after disposal', () => {
    const window = windowFixture() as unknown as BrowserWindow;
    const controller = attachDockCursor(window)!;
    controller.update(state);
    fixture.update.mockClear().mockImplementationOnce(() => {
      throw new Error('native update');
    });
    controller.cursorChanged('nesw-resize');
    controller.cursorChanged('nesw-resize');
    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(attachDockCursor(window)).toBe(controller);
    controller.dispose();
    controller.dispose();
    controller.cursorChanged('grab');
    controller.update(state);
    expect(fixture.dispose).toHaveBeenCalledTimes(1);
    expect(fixture.update).toHaveBeenCalledTimes(2);
    const replacement = attachDockCursor(window)!;
    expect(replacement).not.toBe(controller);
    replacement.dispose();
  });
});

/** Electron's cursor-changed custom payload: PNG pixels at `scale`, hotspot in pixels. */
function customPayload(tag: string, width = 48, height = 48, scale = 2, hotspot = { x: 6, y: 42 }) {
  const png = Buffer.from(`\x89PNG-${tag}-${width}x${height}`);
  return {
    image: { isEmpty: () => false, getSize: () => ({ width, height }), toPNG: vi.fn(() => png) },
    scale,
    size: { width, height },
    hotspot,
  };
}
type Sent = {
  kind: string;
  image?: { id: string; png?: Buffer; scale: number; hotspotX: number; hotspotY: number };
};
const lastSent = () => fixture.update.mock.calls.at(-1)?.[1] as Sent;

describe('page-provided (custom) cursors', () => {
  afterEach(() => {
    fixture.supportsCustom = undefined;
  });

  it('pen -> box -> arrow each reach native although the kind stays custom; PNG bytes cross once per image', () => {
    fixture.supportsCustom = true;
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    const pen = customPayload('pen');
    controller.cursorChanged('custom', pen as never);
    const first = lastSent();
    expect(first.kind).toBe('custom');
    expect(first.image).toMatchObject({ scale: 2, hotspotX: 6, hotspotY: 42 });
    expect(first.image?.png).toBeInstanceOf(Buffer);
    controller.cursorChanged('custom', customPayload('box', 48, 48, 2, { x: 6, y: 10 }) as never);
    const box = lastSent();
    expect(box.kind).toBe('custom');
    expect(box.image?.id).not.toBe(first.image?.id);
    expect(box.image?.png).toBeInstanceOf(Buffer);
    controller.cursorChanged(
      'custom',
      customPayload('arrow', 48, 48, 2, { x: 36, y: 12 }) as never,
    );
    expect(lastSent().image?.id).not.toBe(box.image?.id);
    const calls = fixture.update.mock.calls.length;
    // Same image again (Chromium re-reporting): no native write at all.
    controller.cursorChanged(
      'custom',
      customPayload('arrow', 48, 48, 2, { x: 36, y: 12 }) as never,
    );
    expect(fixture.update).toHaveBeenCalledTimes(calls);
    // Geometry change with the same image: identity only, no PNG bytes.
    controller.update({ ...state, revision: 99 });
    expect(lastSent().image).toMatchObject({ hotspotX: 36, hotspotY: 12 });
    expect(lastSent().image?.png).toBeUndefined();
    controller.dispose();
  });

  it('back to a standard cursor and to none from custom', () => {
    fixture.supportsCustom = true;
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    controller.cursorChanged('custom', customPayload('pen') as never);
    controller.cursorChanged('text');
    expect(lastSent()).toEqual({ ...state, kind: 'text' });
    controller.cursorChanged('custom', customPayload('pen') as never);
    expect(lastSent().kind).toBe('custom');
    controller.cursorChanged('default');
    expect(lastSent()).toEqual({ ...state, kind: 'none' });
    controller.dispose();
  });

  it("an older native build never receives custom (no supportsCustom): today's behaviour", () => {
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    controller.cursorChanged('custom', customPayload('pen') as never);
    expect(lastSent()).toEqual({ ...state, kind: 'none' });
    controller.dispose();
  });

  it.each([
    [
      'empty image',
      {
        ...customPayload('e'),
        image: {
          isEmpty: () => true,
          getSize: () => ({ width: 0, height: 0 }),
          toPNG: () => Buffer.alloc(0),
        },
      },
    ],
    ['hotspot outside', customPayload('h', 48, 48, 2, { x: 48, y: 0 })],
    ['negative hotspot', customPayload('n', 48, 48, 2, { x: -1, y: 3 })],
    ['too many pixels', customPayload('p', 512, 512, 4)],
    ['too many points', customPayload('t', 200, 200, 1)],
    ['bad scale', customPayload('s', 48, 48, 0.5)],
    ['non-finite scale', customPayload('f', 48, 48, Number.NaN)],
  ])('rejects %s: no native custom cursor', (_name, payload) => {
    fixture.supportsCustom = true;
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    controller.cursorChanged('custom', payload as never);
    expect(lastSent()).toEqual({ ...state, kind: 'none' });
    controller.dispose();
  });

  it('a refused custom image falls back to none once and is not retried; another image is', () => {
    fixture.supportsCustom = true;
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    fixture.update.mockImplementationOnce(() => {
      throw new Error('native refused');
    });
    controller.cursorChanged('custom', customPayload('pen') as never);
    expect(lastSent()).toEqual({ ...state, kind: 'none' });
    const calls = fixture.update.mock.calls.length;
    // Chromium re-reporting the refused image, and later geometry updates, never retry it.
    controller.cursorChanged('custom', customPayload('pen') as never);
    controller.update({ ...state, revision: 50 });
    expect(
      fixture.update.mock.calls.slice(calls).every(([, sent]) => (sent as Sent).kind === 'none'),
    ).toBe(true);
    controller.cursorChanged('custom', customPayload('box', 48, 48, 2, { x: 6, y: 10 }) as never);
    expect(lastSent().kind).toBe('custom');
    expect(lastSent().image?.png).toBeInstanceOf(Buffer);
    controller.dispose();
  });

  it('an image whose encoding throws never escapes the handler: none', () => {
    fixture.supportsCustom = true;
    const controller = attachDockCursor(windowFixture() as unknown as BrowserWindow)!;
    controller.update(state);
    const broken = customPayload('x');
    broken.image.toPNG = vi.fn(() => {
      throw new Error('encode failed');
    });
    expect(() => controller.cursorChanged('custom', broken as never)).not.toThrow();
    expect(lastSent()).toEqual({ ...state, kind: 'none' });
    controller.dispose();
  });
});

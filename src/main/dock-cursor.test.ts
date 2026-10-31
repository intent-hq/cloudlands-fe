// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const fixture = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  inspect: vi.fn(),
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

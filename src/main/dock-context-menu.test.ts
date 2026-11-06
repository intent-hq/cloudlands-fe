/**
 * The dock's right-click menu (`window:show-dock-menu`): only the dock's own
 * top-level document may open it, and each item runs the same placement
 * command the in-dock controls send — move to notch/left/right/floating, or
 * hide (dismiss, which Window > Show Intent Dock reverses).
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import type { DockContextMenuRequest } from '../shared/dock-context-menu';
import { m } from '../shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  popup: vi.fn(),
  buildFromTemplate: vi.fn(),
  dockWindow: null as unknown,
  updateDockPlacement: vi.fn(async () => null),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
  BrowserWindow: {
    fromWebContents: (sender: { window?: unknown }) => sender?.window ?? null,
  },
  Menu: {
    buildFromTemplate: (template: unknown) => {
      mocks.buildFromTemplate(template);
      return { popup: mocks.popup };
    },
  },
}));
vi.mock('./ipc-validation-middleware', () => ({
  createSafeValidatedHandler: (_schema: unknown, handler: unknown) => handler,
  createValidatedHandler: (_schema: unknown, handler: unknown) => handler,
}));
vi.mock('../shared/logger', () => ({
  Logger: class {
    warn = vi.fn();
    info = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));
vi.mock('./dock-window', () => ({
  getDockWindow: () => mocks.dockWindow,
  updateDockPlacement: mocks.updateDockPlacement,
  getDockPlacementSnapshot: vi.fn(),
  markDockRendererReady: vi.fn(),
  setDockPointerRegions: vi.fn(),
  switchDockBackend: vi.fn(),
}));

import { registerDockPlacementHandlers } from './dock-placement-ipc';
import { buildDockContextMenuTemplate, showDockContextMenu } from './dock-context-menu';

type FakeWindow = EventEmitter & {
  isDestroyed: () => boolean;
  webContents: { mainFrame: object; window?: unknown };
};
function fakeWindow(): FakeWindow {
  const window: FakeWindow = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { mainFrame: {} as object, window: undefined as unknown },
  });
  window.webContents.window = window;
  return window;
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.popup.mockClear();
  mocks.buildFromTemplate.mockClear();
  mocks.updateDockPlacement.mockClear();
  registerDockPlacementHandlers();
});

describe('window:show-dock-menu', () => {
  const show = (event: unknown, request: DockContextMenuRequest = {}) =>
    mocks.handlers.get(WINDOW_CHANNELS.SHOW_DOCK_MENU)!(event, request);

  it("opens the native menu over the dock for the dock's top-level document", async () => {
    const dock = fakeWindow();
    mocks.dockWindow = dock;
    const pending = show(
      { sender: dock.webContents, senderFrame: dock.webContents.mainFrame },
      {
        machines: [
          { id: 'local', label: 'This Mac' },
          { id: 'remote', label: 'Build server' },
        ],
        currentId: 'local',
      },
    );
    let closed = false;
    void Promise.resolve(pending).then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    const template = mocks.buildFromTemplate.mock.calls[0]![0];
    expect(template[0].submenu[0]).toMatchObject({ checked: true, enabled: false });
    template[0].submenu[1].click();
    mocks.popup.mock.calls[0]![0].callback();
    await expect(pending).resolves.toEqual({ shown: true, backendId: 'remote' });
    expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.popup).toHaveBeenCalledWith({ window: dock, callback: expect.any(Function) });
    expect(dock.listenerCount('closed')).toBe(0);
  });

  it('refuses another window, an unknown sender, and a dock subframe', async () => {
    const dock = fakeWindow();
    const other = fakeWindow();
    mocks.dockWindow = dock;
    for (const event of [
      { sender: other.webContents, senderFrame: other.webContents.mainFrame },
      { sender: {}, senderFrame: {} },
      { sender: dock.webContents, senderFrame: {} },
    ])
      await expect(show(event)).resolves.toEqual({ shown: false });
    expect(mocks.popup).not.toHaveBeenCalled();
    const pending = show({ sender: dock.webContents, senderFrame: dock.webContents.mainFrame });
    dock.webContents.mainFrame = {};
    mocks.popup.mock.calls[0]![0].callback();
    await expect(pending).resolves.toEqual({ shown: false });
  });
});

describe('dock context menu items', () => {
  it('maps each item to its placement command, with hide last', () => {
    const run = vi.fn();
    const template = buildDockContextMenuTemplate(run);
    const items = template.filter((item) => item.type !== 'separator');
    expect(items.map((item) => item.label)).toEqual([
      m.dock_moveNotch_label(),
      m.dock_moveLeft_label(),
      m.dock_moveRight_label(),
      m.dock_moveFloating_label(),
      m.dock_contextMenu_hide_label(),
    ]);
    for (const item of items) (item.click as () => void)();
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      { action: 'move', target: 'notch' },
      { action: 'move', target: 'left' },
      { action: 'move', target: 'right' },
      { action: 'move', target: 'floating' },
      { action: 'dismiss' },
    ]);
  });

  it('runs the chosen command against the dock window, and nothing once it is gone', async () => {
    const dock = fakeWindow();
    const pending = showDockContextMenu(dock as never, {
      machines: [
        { id: 'local', label: 'This Mac' },
        { id: 'remote', label: 'Build server' },
      ],
      currentId: 'local',
    });
    const template = mocks.buildFromTemplate.mock.calls[0]![0] as Array<{ click?: () => void }>;
    template.at(-1)!.click!();
    expect(mocks.updateDockPlacement).toHaveBeenCalledWith(dock, { action: 'dismiss' });
    mocks.updateDockPlacement.mockClear();
    dock.isDestroyed = () => true;
    template[2]!.click!();
    expect(mocks.updateDockPlacement).not.toHaveBeenCalled();
    dock.emit('closed');
    await expect(pending).resolves.toEqual({ shown: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Machine switching in one window: a machine that is still starting keeps the
 * current one on screen (its rail item spins), and the previous machine stays
 * up until the next one has painted, so a switch never shows an empty window.
 */

interface FakeWebContents {
  id: string;
  send: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  isLoadingMainFrame: () => boolean;
}

const fakes = vi.hoisted(() => {
  const webContents = (id: string) => ({
    id,
    send: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    loadURL: vi.fn(async () => {}),
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
  });
  const handlers = new Map<string, (event: unknown, data?: unknown) => Promise<unknown>>();
  const views: Array<{ webContents: FakeWebContents; visible: boolean }> = [];
  const children: unknown[] = [];
  const window = {
    id: 1,
    webContents: webContents('home'),
    contentView: {
      addChildView: (view: unknown) => {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
        children.push(view);
      },
      removeChildView: (view: unknown) => {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
      },
    },
    getContentSize: () => [800, 600],
    isDestroyed: () => false,
    isFocused: () => false,
    on: () => {},
    once: () => {},
  };
  const bindings = new Map<unknown, string>();
  const shown = { current: null as unknown };
  return { webContents, handlers, views, children, window, bindings, shown };
});

vi.mock('electron', () => {
  class WebContentsView {
    webContents: FakeWebContents;
    visible = true;
    constructor() {
      this.webContents = fakes.webContents(`view-${fakes.views.length}`);
      fakes.views.push(this);
    }
    setBounds() {}
    setBackgroundColor() {}
    setVisible(visible: boolean) {
      this.visible = visible;
    }
    getVisible() {
      return this.visible;
    }
  }
  return {
    app: { emit: () => true },
    BrowserWindow: { fromWebContents: () => fakes.window },
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, data?: unknown) => Promise<unknown>) =>
        fakes.handlers.set(channel, handler),
    },
    WebContentsView,
  };
});

vi.mock('../ipc-validation-middleware', () => ({
  createValidatedHandler:
    (schema: { parse: (data: unknown) => unknown }, handler: (e: unknown, v: unknown) => unknown) =>
    async (event: unknown, data: unknown) =>
      handler(event, schema.parse(data)),
}));

vi.mock('../window', () => ({
  buildLoadUrl: () => 'app://index.html',
  buildRendererWebPreferences: () => ({}),
  forwardRendererConsoleToMainLog: () => {},
}));

vi.mock('../offscreen-window', () => ({ getAppWindows: () => [fakes.window] }));

vi.mock('../local-prefs', () => ({
  getLocalPref: async () => true,
  setLocalPref: async () => {},
}));

vi.mock('../window-backend', () => ({
  getBackendIdForWindow: () => 'local',
  getBackendIdForWebContents: (sender: unknown) => fakes.bindings.get(sender) ?? 'local',
  bindMachineViewToBackend: (_window: unknown, sender: unknown, id: string) =>
    fakes.bindings.set(sender, id),
  getRendererWebContents: () => [fakes.window.webContents, ...fakes.bindings.keys()],
  setShownMachineView: (_window: unknown, sender: unknown) => {
    fakes.shown.current = sender;
  },
  getShownRendererWebContents: () => fakes.shown.current ?? fakes.window.webContents,
  getShownBackendIdForWindow: () =>
    fakes.shown.current ? fakes.bindings.get(fakes.shown.current) : 'local',
  isShownRenderer: (_window: unknown, sender: unknown) =>
    sender === (fakes.shown.current ?? fakes.window.webContents),
}));

import { IPC_CHANNELS } from '../../shared/ipc-registry';
import type { MachineRailState } from '../../shared/types/machine-rail';
import { registerMachineRailHandlers } from '../machine-rail';
import { getMachineRailSession, setMachineRailEnabledFlag } from '../machine-rail-state';

const RAIL = IPC_CHANNELS.MACHINE_RAIL;
const REVEAL_TIMEOUT_MS = 250;
const READY_TIMEOUT_MS = 20_000;

function invoke(channel: string, sender: FakeWebContents, data: unknown = {}) {
  const handler = fakes.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender }, data) as Promise<MachineRailState>;
}

const home = () => fakes.window.webContents as FakeWebContents;
const viewOf = (id: string) => {
  const view = fakes.views.find((candidate) => fakes.bindings.get(candidate.webContents) === id);
  if (!view) throw new Error(`No view for ${id}`);
  return view;
};
const state = () => invoke(RAIL.GET_STATE, home());
const topView = () => fakes.children[fakes.children.length - 1];

describe('machine rail switching', () => {
  const connection = {
    connected: new Set<string>(['local', 'b', 'c']),
    retry: vi.fn<(id: string) => Promise<boolean>>(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    setMachineRailEnabledFlag(true);
    connection.connected = new Set(['local', 'b', 'c']);
    connection.retry.mockReset();
    registerMachineRailHandlers({
      listMachineIds: async () => ['local', 'b', 'c'],
      connect: async () => undefined,
      isConnected: (id) => connection.connected.has(id),
      retry: connection.retry,
      disconnect: () => {},
    });
  });

  afterEach(async () => {
    // Turning the lab off drops the window's views, rail and any switch in progress.
    await invoke(RAIL.SET_ENABLED, home(), { enabled: false });
    fakes.views.length = 0;
    fakes.children.length = 0;
    fakes.bindings.clear();
    fakes.shown.current = null;
    vi.useRealTimers();
  });

  it('keeps the current machine on screen while a clicked machine starts, then shows it once painted', async () => {
    const added = await invoke(RAIL.ADD, home(), { id: 'b' });
    expect(added).toMatchObject({ selectedId: 'local', shownId: 'local', pendingId: 'b' });
    expect(viewOf('b').visible).toBe(false);

    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'b', shownId: 'local', pendingId: '' });
    expect(viewOf('b').visible).toBe(true);
    expect(topView()).toBe(viewOf('b'));

    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'b', shownId: 'b' });
  });

  it('shows a machine that never reports ready once the startup budget runs out', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(await state()).toMatchObject({ selectedId: 'b', pendingId: '' });
    expect(viewOf('b').visible).toBe(true);
  });

  it('drops the wait when the user picks another machine first', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    expect(await invoke(RAIL.SELECT, home(), { id: 'local' })).toMatchObject({
      selectedId: 'local',
      pendingId: '',
    });
    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'local', shownId: 'local' });
    expect(viewOf('b').visible).toBe(false);
  });

  it("keeps the previous machine's view up until the window's own renderer has painted", async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SHOWN, viewOf('b').webContents);

    await invoke(RAIL.SELECT, home(), { id: 'local' });
    expect(await state()).toMatchObject({ selectedId: 'local', shownId: 'b' });
    expect(viewOf('b').visible).toBe(true);

    // A late paint report from the machine no longer selected changes nothing.
    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    expect(viewOf('b').visible).toBe(true);

    await invoke(RAIL.SHOWN, home());
    expect(await state()).toMatchObject({ selectedId: 'local', shownId: 'local' });
    expect(viewOf('b').visible).toBe(false);
  });

  it('finishes a switch whose renderer never reports a paint', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS);
    expect(await state()).toMatchObject({ selectedId: 'b', shownId: 'b' });
  });

  it('switches straight to a machine that has started before, over the one on screen', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.ADD, home(), { id: 'c' });
    await invoke(RAIL.READY, viewOf('c').webContents);
    await invoke(RAIL.SHOWN, viewOf('c').webContents);
    expect(viewOf('b').visible).toBe(false);

    expect(await invoke(RAIL.SELECT, home(), { id: 'b' })).toMatchObject({
      selectedId: 'b',
      shownId: 'c',
      pendingId: '',
    });
    expect(topView()).toBe(viewOf('b'));
    expect(viewOf('c').visible).toBe(true);

    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    expect(viewOf('c').visible).toBe(false);
  });

  it('dials an opened machine that went offline once more, keeping the current one up meanwhile', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SELECT, home(), { id: 'local' });
    await invoke(RAIL.SHOWN, home());

    connection.connected.delete('b');
    let settle: (connected: boolean) => void = () => {};
    connection.retry.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    expect(await invoke(RAIL.SELECT, home(), { id: 'b' })).toMatchObject({
      selectedId: 'local',
      pendingId: 'b',
    });
    expect(connection.retry).toHaveBeenCalledWith('b');
    expect(viewOf('b').visible).toBe(false);

    // The attempt fails: show it anyway, so its cannot-connect dialog is seen.
    settle(false);
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({ selectedId: 'b', pendingId: '' }),
    );
    expect(viewOf('b').visible).toBe(true);
  });

  it('switches straight to an opened machine that is connected, without dialling', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SELECT, home(), { id: 'local' });
    expect(await invoke(RAIL.SELECT, home(), { id: 'b' })).toMatchObject({ selectedId: 'b' });
    expect(connection.retry).not.toHaveBeenCalled();
  });

  it('marks a machine degraded while its renderer reports so, in every rail that lists it', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.HEALTH, viewOf('b').webContents, { degraded: true });
    expect((await state()).degradedIds).toEqual(['b']);
    expect(home().send).toHaveBeenLastCalledWith(
      RAIL.CHANGED,
      expect.objectContaining({ degradedIds: ['b'] }),
    );
    await invoke(RAIL.HEALTH, viewOf('b').webContents, { degraded: false });
    expect((await state()).degradedIds).toEqual([]);
  });

  it('drops a degraded mark once no renderer of that machine is left', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.HEALTH, viewOf('b').webContents, { degraded: true });
    await invoke(RAIL.REMOVE, home(), { id: 'b' });
    await invoke(RAIL.ADD, home(), { id: 'b' });
    expect((await state()).degradedIds).toEqual([]);
  });

  it('saves the machine being waited for as the selection, so a quit does not lose it', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    expect(getMachineRailSession(fakes.window as never)).toEqual({
      machineIds: ['b'],
      selectedId: 'b',
    });
    await invoke(RAIL.SELECT, home(), { id: 'local' });
    expect(getMachineRailSession(fakes.window as never)?.selectedId).toBe('local');
  });

  it('forgets the wait for a machine removed while it starts', async () => {
    await invoke(RAIL.ADD, home(), { id: 'b' });
    expect(await invoke(RAIL.REMOVE, home(), { id: 'b' })).toMatchObject({
      machineIds: ['local'],
      pendingId: '',
    });
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(await state()).toMatchObject({ selectedId: 'local', machineIds: ['local'] });
  });
});

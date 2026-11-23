import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Machines in one frame. Every machine, the local one included, is a view in
 * the window; the window's own page is the frame page under them. A machine
 * that is still starting keeps the current one on screen (its rail item
 * spins), and the previous machine stays up until the next one has painted,
 * so a switch never shows an empty window.
 */

interface FakeWebContents {
  id: string;
  send: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  isFocused: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  getTitle: () => string;
  getURL: () => string;
  isLoading: () => boolean;
  isDestroyed: () => boolean;
  isLoadingMainFrame: () => boolean;
}

const fakes = vi.hoisted(() => {
  const webContents = (id: string) => ({
    id,
    send: vi.fn(),
    focus: vi.fn(),
    isFocused: vi.fn(() => false),
    close: vi.fn(),
    loadURL: vi.fn(async () => {}),
    on: vi.fn(),
    once: vi.fn(),
    getTitle: () => '',
    getURL: () => '',
    isLoading: () => false,
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
  });
  const views: Array<{ webContents: FakeWebContents; visible: boolean }> = [];
  const children: unknown[] = [];
  const windowListeners: Record<string, Array<() => void>> = {};
  /** A frame window: its own web contents is the frame page. */
  const makeWindow = () => ({
    id: 1,
    webContents: webContents('frame-page'),
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
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    setTitle: vi.fn(),
    close: vi.fn(),
    on: (event: string, listener: () => void) => {
      (windowListeners[event] ??= []).push(listener);
    },
    once: (event: string, listener: () => void) => {
      (windowListeners[event] ??= []).push(listener);
    },
  });
  return {
    webContents,
    originalWebContents: webContents,
    handlers: new Map<string, (event: unknown, data?: unknown) => Promise<unknown>>(),
    views,
    children,
    makeWindow,
    window: makeWindow(),
    /** Frames besides `window`, in window order after it. */
    otherWindows: [] as Array<ReturnType<typeof makeWindow>>,
    bindings: new Map<unknown, string>(),
    shown: { current: null as unknown },
    windowListeners,
  };
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
    BrowserWindow: {
      fromWebContents: () => fakes.window,
      getFocusedWindow: () =>
        [fakes.window, ...fakes.otherWindows].find((window) => window.isFocused()) ?? null,
    },
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
  buildLoadUrl: (route = '/workspace/new') => `app://workspaces${route}`,
  buildRendererWebPreferences: () => ({}),
  forwardRendererConsoleToMainLog: () => {},
}));

vi.mock('../renderer-hang-monitor', () => ({ attachRendererHangMonitor: () => {} }));

vi.mock('../offscreen-window', () => ({
  getAppWindows: () => [fakes.window, ...fakes.otherWindows],
}));

const railPref = vi.hoisted(() => ({ value: true as unknown }));

vi.mock('../local-prefs', () => ({
  getStrictLocalPref: async () => {
    if (railPref.value instanceof Error) throw railPref.value;
    return railPref.value;
  },
  setLocalPref: async () => {},
}));

/** The live machine views: every bound view not closed yet. */
const liveViews = () =>
  [...fakes.bindings.keys()].filter(
    (contents) => !(contents as FakeWebContents).close.mock.calls.length,
  ) as FakeWebContents[];

vi.mock('../window-backend', () => ({
  getWindowForWebContents: () => fakes.window,
  getBackendIdForWindow: () => 'local',
  getBackendIdForWebContents: (sender: unknown) => fakes.bindings.get(sender) ?? 'local',
  bindMachineViewToBackend: (_window: unknown, sender: unknown, id: string) =>
    fakes.bindings.set(sender, id),
  getRendererWebContents: () => liveViews(),
  setShownMachineView: (_window: unknown, sender: unknown) => {
    fakes.shown.current = sender;
  },
  getShownRendererWebContents: () => fakes.shown.current ?? fakes.window.webContents,
  isShownRenderer: (_window: unknown, sender: unknown) =>
    sender === fakes.shown.current && sender !== fakes.window.webContents,
  isFrameWindow: () => true,
  isMachineViewOf: (_window: unknown, sender: unknown) => fakes.bindings.has(sender),
}));

import { IPC_CHANNELS } from '../../shared/ipc-registry';
import type { MachineRailState } from '../../shared/types/machine-rail';
import { registerChatWindow } from '../chat-window-identity';
import {
  loadMachineRailEnabled,
  openInvitedMachineInWindow,
  registerMachineRailHandlers,
  removeMachineFromAllRails,
  selectMachineInFrame,
} from '../machine-rail';
import {
  addMachineToFrame,
  getMachineRailSession,
  openFrameMachines,
  readWindowRail,
  selectFrameMachine,
  writeWindowRail,
  isMachineRailEnabled,
  setMachineRailEnabledFlag,
  showRailMachine,
  startRailMachineRenderer,
} from '../machine-rail-state';

const RAIL = IPC_CHANNELS.MACHINE_RAIL;
const REVEAL_TIMEOUT_MS = 250;
const READY_TIMEOUT_MS = 20_000;

function invoke(channel: string, sender: FakeWebContents, data: unknown = {}) {
  const handler = fakes.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender }, data) as Promise<MachineRailState>;
}

/** The frame page: the window's own web contents, under every machine's view. */
const framePage = () => fakes.window.webContents as FakeWebContents;
/** The latest view of machine `id`. */
const viewOf = (id: string) => {
  const view = fakes.views.filter((candidate) => fakes.bindings.get(candidate.webContents) === id);
  if (view.length === 0) throw new Error(`No view for ${id}`);
  return view[view.length - 1];
};
const local = () => viewOf('local').webContents;
const state = () => invoke(RAIL.GET_STATE, framePage());
const topView = () => fakes.children[fakes.children.length - 1];
const openFrame = (machines: Array<{ id: string; route?: string }>, selectedId: string) =>
  openFrameMachines(fakes.window as never, machines, selectedId) as unknown as FakeWebContents;

const connection = {
  connected: new Set<string>(['local', 'b', 'c']),
  retry: vi.fn<(id: string) => Promise<boolean>>(),
  listeners: new Set<(id: string) => void>(),
  /** A machine's client finished connecting. */
  connect(id: string) {
    this.connected.add(id);
    for (const listener of this.listeners) listener(id);
  },
  onConnected(listener: (id: string) => void) {
    connection.listeners.add(listener);
    return () => connection.listeners.delete(listener);
  },
};
const disconnect = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fakes.window = fakes.makeWindow();
  registerChatWindow(fakes.window as never);
  setMachineRailEnabledFlag(true);
  connection.connected = new Set(['local', 'b', 'c']);
  connection.retry.mockReset();
  connection.listeners.clear();
  disconnect.mockReset();
  registerMachineRailHandlers({
    listMachineIds: async () => ['local', 'b', 'c'],
    connect: async () => undefined,
    isConnected: (id) => connection.connected.has(id),
    onConnected: (listener) => connection.onConnected(listener),
    retry: connection.retry,
    disconnect,
  });
});

afterEach(() => {
  // Closing the window drops its views, rail and any switch in progress.
  for (const listener of fakes.windowListeners.closed ?? []) listener();
  for (const key of Object.keys(fakes.windowListeners)) delete fakes.windowListeners[key];
  fakes.otherWindows.length = 0;
  fakes.views.length = 0;
  fakes.children.length = 0;
  fakes.bindings.clear();
  fakes.shown.current = null;
  vi.useRealTimers();
});

it('leaves an auxiliary window untouched when opening an invited workspace', async () => {
  const auxiliary = { ...fakes.window, id: 2 };
  expect(await openInvitedMachineInWindow(auxiliary as never, 'b', 'shared-ws')).toBe(false);
  expect(fakes.views).toHaveLength(0);
  expect(auxiliary.show).not.toHaveBeenCalled();
});

it('loads the rail on unless the user turned it off or the preference cannot be read', async () => {
  for (const [saved, expected] of [
    [undefined, true],
    [true, true],
    [false, false],
    [new Error('unreadable'), false],
  ] as const) {
    railPref.value = saved;
    await loadMachineRailEnabled();
    expect(isMachineRailEnabled(), String(saved)).toBe(expected);
  }
  railPref.value = true;
});

describe('a frame open on the local machine', () => {
  beforeEach(async () => {
    openFrame([{ id: 'local' }], 'local');
    await invoke(RAIL.READY, local());
    await invoke(RAIL.SHOWN, local());
  });

  it('serves the local machine from a view, never from the frame page', async () => {
    expect(fakes.views).toHaveLength(1);
    expect(fakes.bindings.get(local())).toBe('local');
    expect(await state()).toMatchObject({
      machineIds: ['local'],
      selectedId: 'local',
      shownId: 'local',
    });
    expect(viewOf('local').visible).toBe(true);
  });

  it('hydrates native window focus when a started machine is ready and selected', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    const child = viewOf('b').webContents;
    await invoke(RAIL.READY, child);
    expect(child.send).toHaveBeenCalledWith('window:focus', false);
    const focused = vi.spyOn(fakes.window, 'isFocused').mockReturnValue(true);
    try {
      child.send.mockClear();
      await invoke(RAIL.SELECT, local(), { id: 'b' });
      expect(child.send).toHaveBeenCalledWith('window:focus', true);
    } finally {
      focused.mockRestore();
    }
  });

  it("queues the invited workspace for the new machine's view", async () => {
    expect(await openInvitedMachineInWindow(fakes.window as never, 'b', 'shared-ws')).toBe(true);
    const { consumePendingDeepLinks } =
      await import('../../features/deeplink/main/pending-deep-links');
    expect(consumePendingDeepLinks(viewOf('b').webContents.id as never).actions).toEqual([
      { type: 'open', params: { id: 'shared-ws' } },
    ]);
    expect(consumePendingDeepLinks(local().id as never).actions).toEqual([]);
  });

  it('leaves a machine that cannot join a rail to its own window, instead of failing', async () => {
    // Not a rail candidate (e.g. this app's own daemon, or a node).
    await expect(openInvitedMachineInWindow(fakes.window as never, 'self-daemon')).resolves.toBe(
      false,
    );
    expect(fakes.views).toHaveLength(1);
  });

  it('does not add a machine after cancellation or while the rail is disabled', async () => {
    expect(
      await openInvitedMachineInWindow(fakes.window as never, 'b', 'shared-ws', () => false),
    ).toBe(false);
    setMachineRailEnabledFlag(false);
    expect(await openInvitedMachineInWindow(fakes.window as never, 'b', 'shared-ws')).toBe(false);
    expect(fakes.views).toHaveLength(1);
  });

  it('keeps the current machine on screen while a clicked machine starts, then shows it once painted', async () => {
    const added = await invoke(RAIL.ADD, local(), { id: 'b' });
    expect(added).toMatchObject({ selectedId: 'local', shownId: 'local', pendingId: 'b' });
    expect(viewOf('b').visible).toBe(false);

    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'b', shownId: 'local', pendingId: '' });
    expect(viewOf('b').visible).toBe(true);
    expect(topView()).toBe(viewOf('b'));

    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'b', shownId: 'b' });
    expect(viewOf('local').visible).toBe(false);
  });

  it('shows a machine that never reports ready once the startup budget runs out', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(await state()).toMatchObject({ selectedId: 'b', pendingId: '' });
    expect(viewOf('b').visible).toBe(true);
  });

  it('drops the wait when the user picks another machine first', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    expect(await invoke(RAIL.SELECT, local(), { id: 'local' })).toMatchObject({
      selectedId: 'local',
      pendingId: '',
    });
    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'local', shownId: 'local' });
    expect(viewOf('b').visible).toBe(false);
  });

  it("keeps the previous machine's view up until the selected one has painted", async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SHOWN, viewOf('b').webContents);

    await invoke(RAIL.SELECT, local(), { id: 'local' });
    expect(await state()).toMatchObject({ selectedId: 'local', shownId: 'b' });
    expect(viewOf('b').visible).toBe(true);

    // A late paint report from the machine no longer selected changes nothing.
    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    expect(viewOf('b').visible).toBe(true);

    await invoke(RAIL.SHOWN, local());
    expect(await state()).toMatchObject({ selectedId: 'local', shownId: 'local' });
    expect(viewOf('b').visible).toBe(false);
  });

  it('finishes a switch whose renderer never reports a paint', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS);
    expect(await state()).toMatchObject({ selectedId: 'b', shownId: 'b' });
  });

  it('switches straight to a machine that has started before, over the one on screen', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.ADD, local(), { id: 'c' });
    await invoke(RAIL.READY, viewOf('c').webContents);
    await invoke(RAIL.SHOWN, viewOf('c').webContents);
    expect(viewOf('b').visible).toBe(false);

    expect(await invoke(RAIL.SELECT, local(), { id: 'b' })).toMatchObject({
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
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    await invoke(RAIL.SHOWN, local());

    connection.connected.delete('b');
    let settle: (connected: boolean) => void = () => {};
    connection.retry.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)));
    expect(await invoke(RAIL.SELECT, local(), { id: 'b' })).toMatchObject({
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
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    expect(await invoke(RAIL.SELECT, local(), { id: 'b' })).toMatchObject({ selectedId: 'b' });
    expect(connection.retry).not.toHaveBeenCalled();
  });

  it('marks a machine degraded while its renderer reports so, in every view of the frame', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.HEALTH, viewOf('b').webContents, { degraded: true });
    expect((await state()).degradedIds).toEqual(['b']);
    expect(local().send).toHaveBeenLastCalledWith(
      RAIL.CHANGED,
      expect.objectContaining({ degradedIds: ['b'] }),
    );
    expect(framePage().send).not.toHaveBeenCalledWith(RAIL.CHANGED, expect.anything());
    await invoke(RAIL.HEALTH, viewOf('b').webContents, { degraded: false });
    expect((await state()).degradedIds).toEqual([]);
  });

  it('drops a degraded mark once no renderer of that machine is left', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.HEALTH, viewOf('b').webContents, { degraded: true });
    await invoke(RAIL.REMOVE, local(), { id: 'b' });
    await invoke(RAIL.ADD, local(), { id: 'b' });
    expect((await state()).degradedIds).toEqual([]);
  });

  it('saves the machine being waited for as the selection, so a quit does not lose it', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    expect(getMachineRailSession(fakes.window as never)).toEqual({
      machineIds: ['local', 'b'],
      selectedId: 'b',
    });
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    expect(getMachineRailSession(fakes.window as never)?.selectedId).toBe('local');
  });

  it('saves a new order of the rail, with any machine first', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.ADD, local(), { id: 'c' });
    expect(await invoke(RAIL.REORDER, local(), { machineIds: ['c', 'local', 'b'] })).toMatchObject({
      machineIds: ['c', 'local', 'b'],
    });
    expect(getMachineRailSession(fakes.window as never)?.machineIds).toEqual(['c', 'local', 'b']);
    // An order that drops a machine is refused.
    expect(await invoke(RAIL.REORDER, local(), { machineIds: ['c', 'b'] })).toMatchObject({
      machineIds: ['c', 'local', 'b'],
    });
  });

  it('removes the shown machine, the local one included, and shows the next one', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    const localView = local();

    expect(await invoke(RAIL.REMOVE, localView, { id: 'local' })).toMatchObject({
      machineIds: ['b'],
      selectedId: 'b',
    });
    expect(localView.close).toHaveBeenCalled();
    expect(viewOf('b').visible).toBe(true);
    expect(fakes.window.close).not.toHaveBeenCalled();
  });

  it('closes the frame when its last machine is removed', async () => {
    await invoke(RAIL.REMOVE, local(), { id: 'local' });
    expect(fakes.window.close).toHaveBeenCalledOnce();
  });

  it('empties the frame before closing it, so the closing save does not keep the removed machine', async () => {
    let railAtClose: unknown = 'not closed';
    fakes.window.close.mockImplementation(() => {
      railAtClose = getMachineRailSession(fakes.window as never);
    });
    await invoke(RAIL.REMOVE, local(), { id: 'local' });
    expect(railAtClose).toBeUndefined();
  });

  it('releases a remote machine no window holds once it leaves the frame, never the local one', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.REMOVE, local(), { id: 'b' });
    expect(disconnect).toHaveBeenCalledExactlyOnceWith('b');
    disconnect.mockClear();
    for (const listener of fakes.windowListeners.closed ?? []) listener();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('turning the rail off keeps only the machine the frame shows', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    const bView = viewOf('b').webContents;
    expect(await invoke(RAIL.SET_ENABLED, bView, { enabled: false })).toMatchObject({
      enabled: false,
      machineIds: ['b'],
      selectedId: 'b',
    });
    expect(local().close).toHaveBeenCalled();
    expect(viewOf('b').visible).toBe(true);
  });

  it('starts no renderer for a machine no frame holds, or one already running', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await startRailMachineRenderer('local', Date.now() + 30_000);
    await startRailMachineRenderer('c', Date.now() + 30_000);
    expect(fakes.views).toHaveLength(2);
  });

  it('stops waiting for a starting machine at the deadline', async () => {
    await invoke(RAIL.ADD, local(), { id: 'c' });
    await invoke(RAIL.SELECT, local(), { id: 'local' });

    let settled = false;
    void startRailMachineRenderer('c', Date.now() + 5_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('does not wait again for a renderer that never finished starting', async () => {
    await invoke(RAIL.ADD, local(), { id: 'c' });
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);

    let settled = false;
    void startRailMachineRenderer('c', Date.now() + 5_000).then((listed) => {
      settled = listed;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(fakes.views).toHaveLength(2);
  });

  it('reports a rail machine that does not start in time as not ready', async () => {
    await invoke(RAIL.ADD, local(), { id: 'c' });
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    const shown = showRailMachine('c');
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(await shown?.ready).toBe(false);
  });

  it('picks a rail machine on request, starting it, and settles once it is ready', async () => {
    expect(showRailMachine('c')).toBeNull();
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.SELECT, local(), { id: 'local' });

    const shown = showRailMachine('b');
    expect(shown?.window).toBe(fakes.window);
    expect(shown?.contents).toBe(viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'local', pendingId: 'b' });

    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(await shown?.ready).toBe(true);
    expect(await state()).toMatchObject({ selectedId: 'b', pendingId: '' });
    expect(fakes.views).toHaveLength(2);
  });

  it('selects a machine the frame holds, starting it, and settles once it is ready', async () => {
    expect(selectMachineInFrame(fakes.window as never, 'b')).toBeNull();
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.SELECT, local(), { id: 'local' });

    const selected = selectMachineInFrame(fakes.window as never, 'b');
    expect(selected?.contents).toBe(viewOf('b').webContents);
    expect(await state()).toMatchObject({ selectedId: 'local', pendingId: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(await selected?.ready).toBe(true);
    expect(await state()).toMatchObject({ selectedId: 'b', pendingId: '' });
  });

  it('selects a machine whose view has started at once', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);

    const selected = selectMachineInFrame(fakes.window as never, 'local');
    expect(selected?.contents).toBe(local());
    expect(await selected?.ready).toBe(true);
    expect(await state()).toMatchObject({ selectedId: 'local' });
  });

  it('returns to a started machine for a notification without creating another renderer', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    const shown = showRailMachine('local');
    expect(shown?.window).toBe(fakes.window);
    expect(shown?.contents).toBe(local());
    expect(await shown?.ready).toBe(true);
    expect(await state()).toMatchObject({ selectedId: 'local', pendingId: '' });
    expect(fakes.views).toHaveLength(2);
  });

  it.each(['b', 'local'])(
    'waits for an offline %s selection before reporting ready',
    async (id) => {
      await invoke(RAIL.ADD, local(), { id: 'b' });
      await invoke(RAIL.READY, viewOf('b').webContents);
      if (id === 'b') await invoke(RAIL.SELECT, local(), { id: 'local' });
      connection.connected.delete(id);
      let finishRetry!: (connected: boolean) => void;
      connection.retry.mockReturnValueOnce(new Promise((resolve) => (finishRetry = resolve)));

      const shown = showRailMachine(id);
      const completed = vi.fn();
      const ready = shown?.ready.then(completed);
      await vi.advanceTimersByTimeAsync(0);

      expect(completed).not.toHaveBeenCalled();
      expect((await state()).pendingId).toBe(id);
      finishRetry(false);
      await ready;

      expect(completed).toHaveBeenCalledExactlyOnceWith(true);
      expect(await state()).toMatchObject({ selectedId: id, pendingId: '' });
      expect(shown?.contents).toBe(viewOf(id).webContents);
      expect(fakes.views).toHaveLength(2);
    },
  );

  it('cancels the original selection when the user switches away and back during a retry', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    connection.connected.delete('b');
    let finishRetry!: (connected: boolean) => void;
    const retry = new Promise<boolean>((resolve) => (finishRetry = resolve));
    connection.retry.mockReturnValue(retry);

    const original = showRailMachine('b');
    await invoke(RAIL.SELECT, local(), { id: 'local' });
    const current = showRailMachine('b');

    expect(await original?.ready).toBe(false);
    finishRetry(false);
    expect(await current?.ready).toBe(true);
    expect(await state()).toMatchObject({ selectedId: 'b', pendingId: '' });
  });

  it.each(['removed', 'disabled', 'closed'])(
    'cancels a pending notification selection when its frame is %s',
    async (reason) => {
      await invoke(RAIL.ADD, local(), { id: 'b' });
      await invoke(RAIL.SELECT, local(), { id: 'local' });
      const shown = showRailMachine('b');

      if (reason === 'removed') await invoke(RAIL.REMOVE, local(), { id: 'b' });
      else if (reason === 'disabled') await invoke(RAIL.SET_ENABLED, local(), { enabled: false });
      else for (const listener of fakes.windowListeners.closed ?? []) listener();

      expect(await shown?.ready).toBe(false);
    },
  );

  it('gives keyboard focus to the machine on screen when the window regains focus', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    const focused = vi.spyOn(fakes.window, 'isFocused').mockReturnValue(true);
    try {
      viewOf('b').webContents.focus.mockClear();
      for (const listener of fakes.windowListeners.focus ?? []) listener();
      expect(viewOf('b').webContents.focus).toHaveBeenCalled();

      await invoke(RAIL.SELECT, local(), { id: 'local' });
      viewOf('b').webContents.focus.mockClear();
      local().focus.mockClear();
      for (const listener of fakes.windowListeners.focus ?? []) listener();
      expect(local().focus).toHaveBeenCalled();
      expect(viewOf('b').webContents.focus).not.toHaveBeenCalled();
    } finally {
      focused.mockRestore();
    }
  });

  it('leaves keyboard focus alone when the machine on screen already has it', async () => {
    // Refocusing a view that already has focus re-activated its window on
    // Linux/X11, so two frames traded focus thousands of times a second and
    // the main process stopped answering (frame-window E2E).
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    const focused = vi.spyOn(fakes.window, 'isFocused').mockReturnValue(true);
    try {
      viewOf('b').webContents.focus.mockClear();
      viewOf('b').webContents.isFocused.mockReturnValue(true);
      for (const listener of fakes.windowListeners.focus ?? []) listener();
      expect(viewOf('b').webContents.focus).not.toHaveBeenCalled();
    } finally {
      focused.mockRestore();
    }
  });

  it('does not take focus back on a focus event that arrives after the window lost it', async () => {
    // On macOS webContents.focus() also raises its window. A late focus event
    // for a window the user already left raised it over the new one, whose
    // own late event raised it back: two windows swapped places until a
    // switch landed between events.
    await invoke(RAIL.ADD, local(), { id: 'b' });
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SHOWN, viewOf('b').webContents);
    const focused = vi.spyOn(fakes.window, 'isFocused').mockReturnValue(false);
    try {
      viewOf('b').webContents.focus.mockClear();
      for (const listener of fakes.windowListeners.focus ?? []) listener();
      expect(viewOf('b').webContents.focus).not.toHaveBeenCalled();
    } finally {
      focused.mockRestore();
    }
  });

  /** Fire `event` on `contents` as Electron would. */
  const emit = (contents: FakeWebContents, event: string, ...args: unknown[]) => {
    for (const [name, listener] of contents.on.mock.calls as Array<
      [string, (...a: unknown[]) => void]
    >) {
      if (name === event) listener({}, ...args);
    }
  };

  it('stops treating a machine view as ready once its renderer crashes, until it starts again', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    const b = viewOf('b').webContents;
    await invoke(RAIL.READY, b);
    await invoke(RAIL.SELECT, b, { id: 'local' });

    emit(b, 'render-process-gone', { reason: 'crashed' });
    let ready: boolean | undefined;
    void selectMachineInFrame(fakes.window as never, 'b')!.ready.then((value) => {
      ready = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBeUndefined();
    // A reload after the crash reports ready again.
    await invoke(RAIL.READY, b);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);
  });

  it('stops treating a machine view as ready while it loads a new document', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    const b = viewOf('b').webContents;
    await invoke(RAIL.READY, b);
    await invoke(RAIL.SELECT, b, { id: 'local' });

    // A same-document navigation keeps the renderer as it is.
    emit(b, 'did-start-navigation', 'app://workspaces/workspace/x', true, true);
    let ready: boolean | undefined;
    void selectMachineInFrame(fakes.window as never, 'b')!.ready.then((value) => {
      ready = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(true);

    await invoke(RAIL.SELECT, b, { id: 'local' });
    emit(b, 'did-start-navigation', 'app://workspaces/workspace/new', false, true);
    ready = undefined;
    void selectMachineInFrame(fakes.window as never, 'b')!.ready.then((value) => {
      ready = value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBeUndefined();
  });

  it('forgets the wait for a machine removed while it starts', async () => {
    await invoke(RAIL.ADD, local(), { id: 'b' });
    expect(await invoke(RAIL.REMOVE, local(), { id: 'b' })).toMatchObject({
      machineIds: ['local'],
      pendingId: '',
    });
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(await state()).toMatchObject({ selectedId: 'local', machineIds: ['local'] });
  });

  describe('opening a machine some frame holds', () => {
    /** A second frame, after the first in window order, holding `machines` (the first shown). */
    const otherFrame = (machines: string[]) => {
      const window = fakes.makeWindow();
      fakes.otherWindows.push(window);
      writeWindowRail(window as never, { machineIds: machines, selectedId: machines[0] });
      return window;
    };

    it('selects an invited machine the frame already holds, without adding it again', async () => {
      await invoke(RAIL.ADD, local(), { id: 'b' });
      await invoke(RAIL.READY, viewOf('b').webContents);
      await invoke(RAIL.SELECT, local(), { id: 'local' });

      expect(await openInvitedMachineInWindow(fakes.window as never, 'b', 'shared-ws')).toBe(true);

      expect(await state()).toMatchObject({ machineIds: ['local', 'b'], selectedId: 'b' });
      const { consumePendingDeepLinks } =
        await import('../../features/deeplink/main/pending-deep-links');
      expect(consumePendingDeepLinks(viewOf('b').webContents.id as never).actions).toEqual([
        { type: 'open', params: { id: 'shared-ws' } },
      ]);
      expect(fakes.window.focus).toHaveBeenCalled();
    });

    it('shows an invited machine in the other frame that holds it, leaving this one as is', async () => {
      const other = otherFrame(['c', 'b']);

      expect(await openInvitedMachineInWindow(fakes.window as never, 'b', 'shared-ws')).toBe(true);

      expect(readWindowRail(fakes.window as never).machineIds).toEqual(['local']);
      expect(other.focus).toHaveBeenCalled();
      expect(fakes.window.focus).not.toHaveBeenCalled();
      const { consumePendingDeepLinks } =
        await import('../../features/deeplink/main/pending-deep-links');
      expect(consumePendingDeepLinks(viewOf('b').webContents.id as never).actions).toEqual([
        { type: 'open', params: { id: 'shared-ws' } },
      ]);
    });

    it('selects through the window command seam, and adds a machine no frame holds', async () => {
      const other = otherFrame(['c', 'b']);
      const selected = selectFrameMachine(other as never, 'b');
      expect(selected?.window).toBe(other);
      expect(selected?.contents).toBe(viewOf('b').webContents);
      expect(selectFrameMachine(other as never, 'local')).toBeNull();

      fakes.otherWindows.length = 0;
      expect(await addMachineToFrame(fakes.window as never, 'b')).toBe(true);
      expect(readWindowRail(fakes.window as never).machineIds).toEqual(['local', 'b']);
      setMachineRailEnabledFlag(false);
      expect(await addMachineToFrame(fakes.window as never, 'c')).toBe(false);
    });

    it('a rail request for a machine prefers the focused frame holding it', async () => {
      const other = otherFrame(['c', 'b']);
      await invoke(RAIL.ADD, local(), { id: 'b' });
      other.isFocused = () => true;
      expect(showRailMachine('b')?.window).toBe(other);
    });

    it('a forgotten machine leaves every frame, and a frame left empty closes', async () => {
      await invoke(RAIL.ADD, local(), { id: 'b' });
      const onlyB = otherFrame(['b']);
      const mixed = otherFrame(['c', 'b']);

      removeMachineFromAllRails('b');

      expect(readWindowRail(fakes.window as never).machineIds).toEqual(['local']);
      expect(readWindowRail(mixed as never).machineIds).toEqual(['c']);
      expect(onlyB.close).toHaveBeenCalledOnce();
      expect(fakes.window.close).not.toHaveBeenCalled();
      expect(mixed.close).not.toHaveBeenCalled();
    });
  });

  describe('frame backdrop', () => {
    const backdrop = (tint: string) => ({
      background: 'rgba(0, 0, 0, 0)',
      tint,
      reducedMotion: false,
    });
    const pushed = () =>
      framePage()
        .send.mock.calls.filter(([channel]) => channel === RAIL.BACKDROP_CHANGED)
        .map(([, payload]) => payload);

    it("hands the shown machine's backdrop to the frame page, and switches with the machine", async () => {
      await invoke(RAIL.BACKDROP, local(), backdrop('transparent'));
      expect(pushed().at(-1)).toEqual(backdrop('transparent'));
      expect(await invoke(RAIL.GET_BACKDROP, framePage())).toEqual(backdrop('transparent'));

      await invoke(RAIL.ADD, local(), { id: 'b' });
      // A machine that is not shown reports its own, which waits until it shows.
      await invoke(RAIL.BACKDROP, viewOf('b').webContents, backdrop('teal'));
      expect(pushed().at(-1)).toEqual(backdrop('transparent'));

      await invoke(RAIL.READY, viewOf('b').webContents);
      expect(pushed().at(-1)).toEqual(backdrop('teal'));
    });

    it('paints nothing while the rail is off', async () => {
      await invoke(RAIL.BACKDROP, local(), backdrop('transparent'));
      await invoke(RAIL.SET_ENABLED, local(), { enabled: false });
      expect(pushed().at(-1)).toBeNull();
      expect(await invoke(RAIL.GET_BACKDROP, framePage())).toBeNull();
    });
  });
});

describe('the frame page', () => {
  it('may only read the backdrop: rail changes and reports must come from a machine view', async () => {
    openFrame([{ id: 'local' }, { id: 'b' }], 'local');
    const stranger = fakes.webContents('stranger');
    for (const sender of [framePage(), stranger]) {
      await expect(invoke(RAIL.SELECT, sender, { id: 'b' })).rejects.toThrow();
      await expect(invoke(RAIL.ADD, sender, { id: 'c' })).rejects.toThrow();
      await expect(invoke(RAIL.REMOVE, sender, { id: 'local' })).rejects.toThrow();
      await expect(invoke(RAIL.REORDER, sender, { machineIds: ['b', 'local'] })).rejects.toThrow();
      await expect(invoke(RAIL.READY, sender)).rejects.toThrow();
      await expect(invoke(RAIL.SHOWN, sender)).rejects.toThrow();
      await expect(
        invoke(RAIL.BACKDROP, sender, { background: 'red', tint: 'red', reducedMotion: false }),
      ).rejects.toThrow();
    }
    expect(getMachineRailSession(fakes.window as never)).toEqual({
      machineIds: ['local', 'b'],
      selectedId: 'local',
    });
    expect(fakes.window.close).not.toHaveBeenCalled();
    await expect(invoke(RAIL.GET_BACKDROP, framePage())).resolves.not.toBeUndefined();
  });

  const framePageLoads = () => framePage().loadURL.mock.calls.map(([url]) => url);

  it('is not loaded while the rail is off: every machine paints its own shell', async () => {
    setMachineRailEnabledFlag(false);
    openFrame([{ id: 'local' }], 'local');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(framePageLoads()).toEqual([]);
  });

  it('loads once the shown machine has loaded, so the two do not start together', () => {
    fakes.webContents = ((original) => (id: string) => {
      const contents = original(id);
      // Every machine view is still loading its first page.
      return id.startsWith('view-') ? { ...contents, isLoading: () => true } : contents;
    })(fakes.webContents);
    try {
      openFrame([{ id: 'local' }], 'local');
      expect(framePageLoads()).toEqual([]);
      const [event, listener] = local().once.mock.calls.find(
        ([name]) => name === 'did-finish-load',
      ) as [string, () => void];
      expect(event).toBe('did-finish-load');
      listener();
      expect(framePageLoads()).toEqual(['app://workspaces/frame']);
    } finally {
      fakes.webContents = fakes.originalWebContents;
    }
  });

  it('loads when the rail is turned on', async () => {
    setMachineRailEnabledFlag(false);
    openFrame([{ id: 'local' }], 'local');
    await invoke(RAIL.SET_ENABLED, local(), { enabled: true });
    expect(framePageLoads()).toEqual(['app://workspaces/frame']);
  });
});

describe('opening a frame', () => {
  it('starts straight on the machine it shows, which is the only view at first', async () => {
    const shown = openFrame([{ id: 'local' }, { id: 'b' }, { id: 'c' }], 'c');
    expect(fakes.views).toHaveLength(1);
    expect(shown).toBe(viewOf('c').webContents);
    expect(await state()).toMatchObject({
      machineIds: ['local', 'b', 'c'],
      selectedId: 'c',
      shownId: 'c',
      pendingId: '',
    });
    expect(viewOf('c').visible).toBe(true);
  });

  it('keeps only the machine it shows while the rail is off', async () => {
    setMachineRailEnabledFlag(false);
    openFrame([{ id: 'local' }, { id: 'b' }], 'b');
    expect(await state()).toMatchObject({ machineIds: ['b'], selectedId: 'b' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakes.views).toHaveLength(1);
  });

  it('still saves every machine of the frame while the rail is off, so the layout is not lost', async () => {
    setMachineRailEnabledFlag(false);
    openFrame([{ id: 'local' }, { id: 'b' }, { id: 'c' }], 'b');
    expect(getMachineRailSession(fakes.window as never)).toEqual({
      machineIds: ['local', 'b', 'c'],
      selectedId: 'b',
    });
  });

  it('brings back the machines it kept aside when the rail is turned on', async () => {
    setMachineRailEnabledFlag(false);
    openFrame([{ id: 'local' }, { id: 'b' }, { id: 'c' }], 'b');
    await invoke(RAIL.READY, viewOf('b').webContents);
    expect(
      await invoke(RAIL.SET_ENABLED, viewOf('b').webContents, { enabled: true }),
    ).toMatchObject({ enabled: true, machineIds: ['local', 'b', 'c'], selectedId: 'b' });
    // The others load in the background, one at a time, behind the shown one.
    await vi.waitFor(() => expect(fakes.views.length).toBe(2));
    await invoke(RAIL.READY, fakes.views[1].webContents);
    await vi.waitFor(() => expect(fakes.views.length).toBe(3));
    expect(viewOf('b').visible).toBe(true);
    expect(viewOf('c').visible).toBe(false);
  });

  it('keeps the machines aside when the rail is turned off, and drops a forgotten one', async () => {
    openFrame([{ id: 'local' }, { id: 'b' }, { id: 'c' }], 'b');
    await invoke(RAIL.READY, viewOf('b').webContents);
    await invoke(RAIL.SET_ENABLED, viewOf('b').webContents, { enabled: false });
    expect(getMachineRailSession(fakes.window as never)?.machineIds).toEqual(['local', 'b', 'c']);

    removeMachineFromAllRails('c');
    expect(getMachineRailSession(fakes.window as never)).toEqual({
      machineIds: ['local', 'b'],
      selectedId: 'b',
    });
  });

  it('falls back to its first machine when the saved selection is not one of them', async () => {
    openFrame([{ id: 'b' }, { id: 'c' }], 'gone');
    expect(await state()).toMatchObject({ machineIds: ['b', 'c'], selectedId: 'b' });
  });

  it('opens nothing without a machine', () => {
    expect(openFrame([], 'local')).toBeNull();
    expect(fakes.views).toHaveLength(0);
  });

  it('reopens each machine on the page it showed, and a re-added one on its default page', async () => {
    openFrame(
      [
        { id: 'local', route: '/settings' },
        { id: 'b', route: '/workspace/b1' },
        { id: 'c', route: '/workspace/c1' },
      ],
      'c',
    );
    expect(viewOf('c').webContents.loadURL).toHaveBeenCalledWith('app://workspaces/workspace/c1');
    await invoke(RAIL.READY, viewOf('c').webContents);
    await vi.waitFor(() => expect(fakes.views.length).toBe(2));
    expect(viewOf('local').webContents.loadURL).toHaveBeenCalledWith('app://workspaces/settings');
    await invoke(RAIL.READY, viewOf('local').webContents);
    await vi.waitFor(() => expect(fakes.views.length).toBe(3));
    expect(viewOf('b').webContents.loadURL).toHaveBeenCalledWith('app://workspaces/workspace/b1');

    await invoke(RAIL.REMOVE, local(), { id: 'c' });
    await invoke(RAIL.ADD, local(), { id: 'c' });
    expect(viewOf('c').webContents.loadURL).toHaveBeenCalledWith('app://workspaces/workspace/new');
  });

  it('ignores a saved page that is not an app path', () => {
    openFrame([{ id: 'b', route: 'https://example.com/' }], 'b');
    expect(viewOf('b').webContents.loadURL).toHaveBeenCalledWith('app://workspaces/workspace/new');
  });

  it('loads the other connected machines in the background once the shown one is ready, one at a time', async () => {
    openFrame([{ id: 'b' }, { id: 'c' }], 'c');
    // Nothing else loads while the machine on screen is still starting.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakes.views.length).toBe(1);

    await invoke(RAIL.READY, viewOf('c').webContents);
    await vi.waitFor(() => expect(fakes.views.length).toBe(2));
    expect(viewOf('b').visible).toBe(false);
    await invoke(RAIL.READY, viewOf('b').webContents);

    // A machine loaded in the background shows at once when picked.
    expect(await invoke(RAIL.SELECT, viewOf('c').webContents, { id: 'b' })).toMatchObject({
      selectedId: 'b',
      pendingId: '',
    });
  });

  it('moves on to the next machine at once when the one loading is removed', async () => {
    openFrame([{ id: 'local' }, { id: 'b' }, { id: 'c' }], 'local');
    await invoke(RAIL.READY, local());
    await vi.waitFor(() => expect(fakes.views.length).toBe(2));
    await invoke(RAIL.REMOVE, local(), { id: 'b' });
    await vi.waitFor(() => expect(fakes.views.length).toBe(3));
    expect(viewOf('c').visible).toBe(false);
  });

  it('does not let a machine that is slow to connect hold up the others', async () => {
    let failB: () => void = () => {};
    registerMachineRailHandlers({
      listMachineIds: async () => ['local', 'b', 'c'],
      connect: (id) =>
        id === 'b'
          ? new Promise<undefined>((_, reject) => (failB = () => reject(new Error('offline'))))
          : Promise.resolve(undefined),
      isConnected: (id) => connection.connected.has(id),
      onConnected: (listener) => connection.onConnected(listener),
      retry: connection.retry,
      disconnect,
    });
    connection.connected.delete('b');
    openFrame([{ id: 'local' }, { id: 'b' }, { id: 'c' }], 'local');
    await invoke(RAIL.READY, local());
    await vi.waitFor(() => expect(fakes.views.length).toBe(2));
    expect(fakes.bindings.get(fakes.views[1].webContents)).toBe('c');
    failB();
  });

  it('loads a machine that is still connecting at startup once it connects', async () => {
    connection.connected.delete('b');
    openFrame([{ id: 'b' }, { id: 'c' }], 'c');
    await invoke(RAIL.READY, viewOf('c').webContents);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.views.length).toBe(1);
    connection.connect('b');
    await vi.waitFor(() => expect(fakes.views.length).toBe(2));
    expect(viewOf('b').visible).toBe(false);
  });

  it('leaves a machine that is offline at startup to load when picked', async () => {
    connection.connected.delete('b');
    openFrame([{ id: 'b' }, { id: 'c' }], 'c');
    await invoke(RAIL.READY, viewOf('c').webContents);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakes.views.length).toBe(1);
  });

  it('starts a machine that never loaded, hidden, when work for it arrives', async () => {
    connection.connected.delete('b');
    openFrame([{ id: 'b' }, { id: 'c' }], 'c');
    await invoke(RAIL.READY, viewOf('c').webContents);
    // The background start gave up on the machine that was offline at startup.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fakes.views.length).toBe(1);
    connection.connected.add('b');

    let settled = false;
    const started = startRailMachineRenderer('b', Date.now() + 30_000).then(() => {
      settled = true;
    });
    expect(viewOf('b').visible).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await invoke(RAIL.READY, viewOf('b').webContents);
    await started;
    expect(await state()).toMatchObject({ selectedId: 'c', shownId: 'c', pendingId: '' });
    expect(viewOf('b').visible).toBe(false);

    // A machine whose renderer runs already settles at once, without a second view.
    await startRailMachineRenderer('b', Date.now() + 30_000);
    expect(fakes.views.length).toBe(2);
  });
});

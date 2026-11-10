import { describe, expect, it, vi } from 'vitest';
import {
  UNIFIED_SHELL_CHANNELS,
  UnifiedWindowController,
  type UnifiedHostWindow,
  type UnifiedViewHandle,
  type UnifiedWindowHost,
} from './unified-window-controller';

function fakeWindow() {
  let closed: (() => void) | null = null;
  let destroyed = false;
  const window = {
    sent: [] as Array<[string, unknown]>,
    isDestroyed: () => destroyed,
    focus: vi.fn(),
    show: vi.fn(),
    restore: vi.fn(),
    isMinimized: () => false,
    close: vi.fn(() => {
      destroyed = true;
      closed?.();
    }),
    onClosed: (listener: () => void) => {
      closed = listener;
    },
    send(channel: string, payload: unknown) {
      window.sent.push([channel, payload]);
    },
  };
  return window;
}

function fakeView(machineId: string) {
  let destroyed = false;
  return {
    machineId,
    load: vi.fn(),
    navigate: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    send: vi.fn(),
    capture: vi.fn(async () => `data:image/png;base64,${machineId}`),
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => {
      destroyed = true;
    }),
  };
}

function harness(options: { lab?: boolean; failing?: string[]; connected?: string[] } = {}) {
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const views: ReturnType<typeof fakeView>[] = [];
  const connected = new Set(options.connected ?? []);
  const connectOrder: string[] = [];
  const host: UnifiedWindowHost = {
    createWindow: vi.fn(async () => {
      const window = fakeWindow();
      windows.push(window);
      return window as UnifiedHostWindow;
    }),
    createView: vi.fn((_window, machineId) => {
      const view = fakeView(machineId);
      views.push(view);
      return view as UnifiedViewHandle;
    }),
    activateView: vi.fn(),
    connect: vi.fn(async (machineId: string) => {
      connectOrder.push(machineId);
      if (options.failing?.includes(machineId)) throw new Error('keychain prompt cancelled');
      connected.add(machineId);
    }),
    isConnected: (machineId) => connected.has(machineId),
    releaseHolder: vi.fn(),
    loadState: vi.fn(async () => null),
    saveState: vi.fn(async () => {}),
    isLabEnabled: () => options.lab ?? true,
  };
  return { controller: new UnifiedWindowController(host), host, windows, views, connectOrder };
}

describe('UnifiedWindowController', () => {
  it('keeps exactly one Unified window: opening again focuses it', async () => {
    const h = harness();
    await expect(h.controller.openOrFocus()).resolves.toEqual({ opened: true });
    await expect(h.controller.openOrFocus()).resolves.toEqual({ opened: false });
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0].focus).toHaveBeenCalled();
  });

  it('never opens while the lab is off', async () => {
    const h = harness({ lab: false });
    await expect(h.controller.openOrFocus()).resolves.toEqual({ opened: false });
    expect(h.host.createWindow).not.toHaveBeenCalled();
  });

  it('creates a machine view lazily, loads it once, then navigates and shows only it', async () => {
    const h = harness();
    await h.controller.openOrFocus();
    h.controller.setContentBounds({ x: 0, y: 40, width: 800, height: 600 });
    h.controller.show('local', '/');
    h.controller.show('studio', '/workspace/w2');
    h.controller.show('local', '/workspace/w1');

    expect(h.views.map((view) => view.machineId)).toEqual(['local', 'studio']);
    const [local, studio] = h.views;
    expect(local.load).toHaveBeenCalledWith('/');
    expect(local.navigate).toHaveBeenCalledWith('/workspace/w1');
    expect(studio.load).toHaveBeenCalledWith('/workspace/w2');
    expect(studio.setBounds).toHaveBeenCalledWith({ x: 0, y: 40, width: 800, height: 600 });
    expect(local.setVisible).toHaveBeenLastCalledWith(true);
    expect(studio.setVisible).toHaveBeenLastCalledWith(false);
    expect(h.controller.getActiveMachineId()).toBe('local');
  });

  it("hands each view its machine's tabs, including views loaded later", async () => {
    const h = harness();
    await h.controller.openOrFocus();
    h.controller.show('local', '/');
    h.controller.setTabs({ local: ['w1'], studio: ['w2', 'w3'] });
    h.controller.show('studio', '/workspace/w2');
    expect(h.views[0].send).toHaveBeenCalledWith(UNIFIED_SHELL_CHANNELS.TABS, { workspaceIds: ['w1'] });
    expect(h.views[1].send).toHaveBeenCalledWith(UNIFIED_SHELL_CHANNELS.TABS, {
      workspaceIds: ['w2', 'w3'],
    });
  });

  it('connects machines one at a time and does not retry a failure in the background', async () => {
    const h = harness({ failing: ['studio'], connected: ['local'] });
    await h.controller.openOrFocus();
    await h.controller.connectInBackground(['local', 'studio', 'guest']);
    await h.controller.connectInBackground(['local', 'studio', 'guest']);
    expect(h.connectOrder).toEqual(['studio', 'guest']);
    expect(h.windows[0].sent).toContainEqual([
      UNIFIED_SHELL_CHANNELS.MACHINE_STATE,
      { machineId: 'studio', state: 'failed' },
    ]);

    // Picking the machine retries it (and may prompt again).
    await expect(h.controller.connect('studio')).resolves.toBe(false);
    expect(h.connectOrder).toEqual(['studio', 'guest', 'studio']);
  });

  it('forwards an open request from a view to the shell', async () => {
    const h = harness();
    await h.controller.openOrFocus();
    expect(h.controller.requestOpen('studio', 'w9')).toBe(true);
    expect(h.windows[0].sent).toContainEqual([
      UNIFIED_SHELL_CHANNELS.OPEN_REQUEST,
      { machineId: 'studio', workspaceId: 'w9' },
    ]);
  });

  it('on close destroys views and releases every machine it held', async () => {
    const h = harness({ connected: ['local'] });
    await h.controller.openOrFocus();
    await h.controller.connectInBackground(['local', 'guest']);
    h.controller.show('studio', '/');
    h.controller.close();
    expect(h.views[0].destroy).toHaveBeenCalled();
    expect(vi.mocked(h.host.releaseHolder).mock.calls.map(([id]) => id).sort()).toEqual([
      'guest',
      'studio',
    ]);
    expect(h.controller.isOpen()).toBe(false);
    expect(h.controller.show('studio', '/')).toBe(false);
  });

  it('hides views behind a shell menu, hands back a snapshot, and restores them on close', async () => {
    const h = harness();
    await h.controller.openOrFocus();
    h.controller.show('local', '/');
    await expect(h.controller.setOverlay(true)).resolves.toBe('data:image/png;base64,local');
    expect(h.views[0].setVisible).toHaveBeenLastCalledWith(false);

    // A view shown while the menu is open stays hidden until it closes.
    h.controller.show('studio', '/');
    expect(h.views[1].setVisible).toHaveBeenLastCalledWith(false);

    await expect(h.controller.setOverlay(false)).resolves.toBeNull();
    expect(h.views[1].setVisible).toHaveBeenLastCalledWith(true);
  });
});

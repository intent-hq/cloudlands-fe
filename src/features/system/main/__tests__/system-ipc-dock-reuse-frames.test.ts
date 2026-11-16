import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Dock "open workspace" (WINDOW.OPEN_NEW with reuseExistingWorkspace) with
 * frame windows: a frame that holds the workspace's machine without showing
 * it is reused, the machine is selected there and the workspace is routed to
 * that machine's own view, instead of a new window opening.
 */

type Handler = (...args: any[]) => unknown;

interface FakeContents {
  id: number;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  getURL: () => string;
  isLoadingMainFrame: () => boolean;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

interface FakeFrame {
  id: number;
  machines: string[];
  shown: string;
  views: Map<string, FakeContents>;
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  isMinimized: () => boolean;
  isDestroyed: () => boolean;
  webContents: FakeContents;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

// Live frames, in window order.
const frameList = vi.hoisted((): FakeFrame[] => []);
const fakes = vi.hoisted(() => ({
  focused: null as FakeFrame | null,
  handle: vi.fn(),
  openMachineFrame: vi.fn(),
  select: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => frameList),
    fromId: vi.fn((id: number) => frameList.find((frame) => frame.id === id) ?? null),
    getFocusedWindow: vi.fn(() => fakes.focused),
    fromWebContents: vi.fn(() => null),
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: fakes.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
  getBackendIdForIpcSender: vi.fn((sender: { backendId?: string }) => sender.backendId ?? 'local'),
}));
vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));
vi.mock('../../../../main/window', () => ({
  forwardRendererConsoleToMainLog: vi.fn(),
  stampWindowWithBackend: vi.fn(),
  openMachineFrame: fakes.openMachineFrame,
}));
vi.mock('../../../../main/frames', () => ({
  isFrame: (window: FakeFrame | null | undefined) => !!window && frameList.includes(window),
  frameMachines: (window: FakeFrame) => [...window.machines],
  shownMachine: (window: FakeFrame) => window.shown,
  rendererFor: (window: FakeFrame, id: string) => window.views.get(id) ?? null,
  framesHolding: (id: string) => frameList.filter((frame) => frame.machines.includes(id)),
  // The pick openOrFocusWindowsForBackend uses: focused holder, else the
  // first holder (most recent focus is modelled by array order here).
  frameToShow: (id: string) => {
    const holders = frameList.filter((frame) => frame.machines.includes(id));
    if (fakes.focused && holders.includes(fakes.focused)) return fakes.focused;
    return holders[0] ?? null;
  },
}));
vi.mock('../../../../main/machine-rail-state', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  selectFrameMachine: fakes.select,
}));

import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

let nextContentsId = 100;
function contents(): FakeContents {
  return {
    id: nextContentsId++,
    send: vi.fn(),
    isDestroyed: () => false,
    getURL: () => 'app://workspaces/',
    isLoadingMainFrame: () => false,
    on: vi.fn(),
    once: vi.fn(),
  };
}

function frame(id: number, machines: string[], shown: string): FakeFrame {
  return {
    id,
    machines,
    shown,
    views: new Map(machines.map((machine) => [machine, contents()])),
    focus: vi.fn(),
    show: vi.fn(),
    restore: vi.fn(),
    isMinimized: () => false,
    isDestroyed: () => false,
    webContents: contents(),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function openNew(): Handler {
  const call = fakes.handle.mock.calls.find(([channel]) => channel === WINDOW_CHANNELS.OPEN_NEW);
  if (!call) throw new Error('OPEN_NEW not registered');
  return call[1] as Handler;
}

const fromDock = (backendId: string) => ({ sender: { backendId } });

describe('dock open-workspace reuse with frame windows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frameList.length = 0;
    fakes.focused = null;
    fakes.select.mockImplementation((window: FakeFrame, id: string) => {
      window.shown = id;
      return { window, contents: window.views.get(id), ready: Promise.resolve(true) };
    });
    fakes.openMachineFrame.mockImplementation(async (opts: { machineId: string }) => {
      const created = frame(90, [opts.machineId], opts.machineId);
      return { window: created, contents: created.views.get(opts.machineId) };
    });
    setupSystemIPC();
  });

  it('reuses a frame that holds the machine hidden, selects it and routes the workspace to its view', async () => {
    const holder = frame(1, ['local', 'remote-a'], 'local');
    frameList.push(holder);
    fakes.focused = holder;

    const result = await openNew()(fromDock('remote-a'), {
      route: '/workspace/ws-1',
      reuseExistingWorkspace: true,
      agentId: 'agent-1',
    });

    expect(result).toEqual({ success: true, windowId: 1, reused: true });
    expect(fakes.openMachineFrame).not.toHaveBeenCalled();
    expect(fakes.select).toHaveBeenCalledWith(holder, 'remote-a');
    expect(holder.focus).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(holder.views.get('remote-a')!.send).toHaveBeenCalledWith('notification:navigate', {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      }),
    );
    expect(holder.views.get('local')!.send).not.toHaveBeenCalled();
  });

  it('picks the focused frame among several holding the machine hidden', async () => {
    const first = frame(1, ['local', 'remote-a'], 'local');
    const focused = frame(2, ['local', 'remote-a'], 'local');
    frameList.push(first, focused);
    fakes.focused = focused;

    const result = await openNew()(fromDock('remote-a'), {
      route: '/workspace/ws-1',
      reuseExistingWorkspace: true,
    });

    expect(result).toEqual({ success: true, windowId: 2, reused: true });
    expect(fakes.select).toHaveBeenCalledWith(focused, 'remote-a');
    expect(first.views.get('remote-a')!.send).not.toHaveBeenCalled();
  });

  it('still reuses a frame showing the machine without selecting anything', async () => {
    const showing = frame(1, ['remote-a'], 'remote-a');
    frameList.push(showing);

    const result = await openNew()(fromDock('remote-a'), {
      route: '/workspace/ws-1',
      reuseExistingWorkspace: true,
    });

    expect(result).toEqual({ success: true, windowId: 1, reused: true });
    expect(fakes.select).not.toHaveBeenCalled();
    expect(showing.views.get('remote-a')!.send).toHaveBeenCalledWith('notification:navigate', {
      workspaceId: 'ws-1',
    });
  });

  it('opens a new frame when no frame holds the machine', async () => {
    frameList.push(frame(1, ['local'], 'local'));

    const result = await openNew()(fromDock('remote-a'), {
      route: '/workspace/ws-1',
      reuseExistingWorkspace: true,
    });

    expect(result).toEqual({ success: true, windowId: 90 });
    expect(fakes.openMachineFrame).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'remote-a' }),
    );
    expect(fakes.select).not.toHaveBeenCalled();
  });
});

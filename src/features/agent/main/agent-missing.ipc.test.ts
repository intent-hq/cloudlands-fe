/**
 * Circuit-breaker status reaches the renderer that hosts the workspace: with
 * the machine rail, that can be a machine view the window does not show.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  windows: [] as unknown[],
  statusListener: null as null | ((workspaceId: string, status: unknown) => void),
  hostingRenderers: vi.fn((): unknown[] => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => fakes.windows },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('$shared/services/agent-circuit-breaker', () => ({
  agentCircuitBreaker: {
    onAnyStatusChange: (listener: (workspaceId: string, status: unknown) => void) => {
      fakes.statusListener = listener;
      return () => {
        fakes.statusListener = null;
      };
    },
    reset: vi.fn(),
    getStatus: vi.fn(),
  },
}));

vi.mock('../../system/main/system.ipc', () => ({
  getRendererWebContentsForWorkspace: fakes.hostingRenderers,
}));

import { registerMissingAgentHandlers } from './agent-missing.ipc';
import { ANY_HOST } from '../../system/main/window-workspace-tracking';

let nextId = 1;

function makeContents() {
  return { id: nextId++, send: vi.fn(), isDestroyed: () => false };
}

function makeWindow(id: number) {
  return { id, isDestroyed: () => false, webContents: makeContents() };
}

const tripped = { state: 'open', reason: 'too many failures' };

beforeEach(() => {
  fakes.windows = [];
  fakes.hostingRenderers.mockReset().mockReturnValue([]);
  registerMissingAgentHandlers();
});

describe('circuit-breaker status broadcast', () => {
  it('reaches the hidden machine view hosting the workspace, not its window’s own renderer', () => {
    const railWindow = makeWindow(7);
    const hiddenView = makeContents();
    fakes.windows = [railWindow];
    // The window shows its home machine; its hidden view hosts the workspace.
    fakes.hostingRenderers.mockReturnValue([hiddenView]);

    fakes.statusListener?.('ws-b', tripped);

    expect(hiddenView.send).toHaveBeenCalledExactlyOnceWith('agent:circuit-breaker:status', {
      workspaceId: 'ws-b',
      status: tripped,
    });
    expect(railWindow.webContents.send).not.toHaveBeenCalled();
    expect(fakes.hostingRenderers).toHaveBeenCalledWith('ws-b', ANY_HOST);
  });

  it('broadcasts to every window when no renderer hosts the workspace', () => {
    const first = makeWindow(1);
    const second = makeWindow(2);
    fakes.windows = [first, second];

    fakes.statusListener?.('ws-closed', tripped);

    for (const window of [first, second]) {
      expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
        'agent:circuit-breaker:status',
        { workspaceId: 'ws-closed', status: tripped },
      );
    }
  });

  it('keeps notifying the other hosts when one renderer fails to receive', () => {
    const failing = {
      ...makeContents(),
      send: vi.fn(() => {
        throw new Error('gone');
      }),
    };
    const healthy = makeContents();
    fakes.hostingRenderers.mockReturnValue([failing, healthy]);

    fakes.statusListener?.('ws-b', tripped);

    expect(healthy.send).toHaveBeenCalledExactlyOnceWith('agent:circuit-breaker:status', {
      workspaceId: 'ws-b',
      status: tripped,
    });
  });
});

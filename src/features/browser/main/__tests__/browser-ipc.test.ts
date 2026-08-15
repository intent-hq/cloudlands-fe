import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../../shared/ipc-registry';

const mocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

vi.mock('../embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: {
    registerTab: vi.fn(),
    unregisterTab: vi.fn(),
  },
}));

import { registerBrowserHandlers } from '../browser.ipc';

type IpcHandler = (event: unknown, data: unknown) => Promise<unknown>;

function registerAndGetExecHandler(): IpcHandler {
  registerBrowserHandlers();
  const entry = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === IPC_CHANNELS.BROWSER.EXEC);
  expect(entry, 'browser:exec handler must be registered').toBeDefined();
  return entry![1] as IpcHandler;
}

describe('browser:exec IPC workspace routing', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset();
    mocks.sendToWorkspaceWindows.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(123);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => vi.restoreAllMocks());

  it('opens a tab with the exact workspace-scoped channel and payload', async () => {
    const handler = registerAndGetExecHandler();

    const workspaceId = ' ws-1 ';
    const result = await handler(
      {},
      {
        actions: [{ action: 'openTab', url: 'https://example.test', position: 'replace' }],
        workspaceId,
      },
    );

    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledExactlyOnceWith(
      workspaceId,
      IPC_CHANNELS.BROWSER.OPEN_TAB,
      {
        url: 'https://example.test',
        position: 'replace',
        workspaceId,
        tabId: 'tab-123-i',
      },
    );
    expect(result).toEqual({
      success: true,
      results: [
        {
          action: 'openTab',
          success: true,
          result: {
            success: true,
            message: 'Opening browser tab with URL: https://example.test',
            tabId: 'tab-123-i',
          },
        },
      ],
    });
  });

  it.each([undefined, '', '   ', '\t\n', null, 42, { workspaceId: 'ws-1' }])(
    'rejects openTab without a valid workspaceId and emits nothing: %j',
    async (workspaceId) => {
      const handler = registerAndGetExecHandler();

      const result = await handler(
        {},
        {
          actions: [{ action: 'openTab', url: 'https://example.test' }],
          ...(workspaceId === undefined ? {} : { workspaceId }),
        },
      );

      expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../../../shared/ipc-registry';

const mocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
  backendClient: {
    getConfig: vi.fn(() => ({ transport: 'uds' as const, socketPath: '/tmp/intentd.sock' })),
  },
}));

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  BACKEND_CLIENT_DISCONNECTED_EVENT: 'backend-client-disconnected',
  getBackendClient: vi.fn(() => mocks.backendClient),
  getBackendClientForConnection: vi.fn(() => mocks.backendClient),
  getBackendClientForId: vi.fn(() => mocks.backendClient),
  getLocalBackendClient: vi.fn(() => mocks.backendClient),
  getBackendIdForIpcSender: vi.fn(() => 'local'),
  getPrimaryBackendId: vi.fn(() => 'local'),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('../../../../main/window', () => ({
  getFocusedWindowBackendId: vi.fn(() => 'local'),
}));

vi.mock('../embedded-browser-cdp-service', () => ({
  DEFAULT_AGENT_VIEWPORT: { width: 1280, height: 800 },
  AGENT_VIEWPORT_MIN_PX: 320,
  AGENT_VIEWPORT_MAX_PX: 3840,
  embeddedBrowserCdp: {
    registerTab: vi.fn(),
    unregisterTab: vi.fn(),
    waitForTabRegistration: vi.fn().mockResolvedValue(true),
    reportTabViewBounds: vi.fn(),
    clearTabViewBounds: vi.fn(),
    setTabViewport: vi.fn(),
  },
}));

import { registerBrowserHandlers } from '../browser.ipc';

type IpcHandler = (event: unknown, data: unknown) => Promise<unknown>;

function registerAndGetHandler(channel: string): IpcHandler {
  registerBrowserHandlers();
  const entry = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  expect(entry, `${channel} handler must be registered`).toBeDefined();
  return entry![1] as IpcHandler;
}

function registerAndGetExecHandler(): IpcHandler {
  return registerAndGetHandler(IPC_CHANNELS.BROWSER.EXEC);
}

describe('browser:exec IPC workspace routing', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset();
    mocks.sendToWorkspaceWindows.mockReset();
    mocks.sendToWorkspaceWindows.mockReturnValue({
      windowCount: 1,
      browserClientsNotified: false,
      delivered: true,
    });
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

  // Regression (intent-hq/monorepo#2602): openTab used to return
  // { success: true } plus a pre-generated tabId even when zero windows
  // received the message — a phantom tab that never existed.
  it('fails openTab with a clear error when the workspace is not open in any window', async () => {
    mocks.sendToWorkspaceWindows.mockReturnValue({
      windowCount: 0,
      browserClientsNotified: false,
      delivered: false,
    });
    const handler = registerAndGetExecHandler();

    const result = await handler(
      {},
      {
        actions: [{ action: 'openTab', url: 'https://example.test' }],
        workspaceId: 'ws-closed',
      },
    );

    expect(result).toMatchObject({
      success: false,
      results: [
        {
          action: 'openTab',
          success: false,
          result: {
            success: false,
            message: expect.stringContaining('workspace ws-closed is not open in any window'),
          },
        },
      ],
    });
    expect(
      (result as { results: Array<{ result: { tabId?: string } }> }).results[0].result.tabId,
    ).toBeUndefined();
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

// Visible webview bounds reports for scale-to-fit (docs/protocol §5.9):
// a full payload records bounds, a tabId-only payload is an explicit clear
// (the element stopped displaying the tab — unmount/handoff).
describe('browser:report-tab-bounds IPC', () => {
  beforeEach(async () => {
    vi.mocked(ipcMain.handle).mockReset();
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    vi.mocked(embeddedBrowserCdp.reportTabViewBounds).mockClear();
    vi.mocked(embeddedBrowserCdp.clearTabViewBounds).mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('routes a full payload to reportTabViewBounds', async () => {
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    const handler = registerAndGetHandler(IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS);

    await handler({}, { tabId: 'tab-1', width: 640, height: 400 });

    expect(embeddedBrowserCdp.reportTabViewBounds).toHaveBeenCalledWith('tab-1', 640, 400);
    expect(embeddedBrowserCdp.clearTabViewBounds).not.toHaveBeenCalled();
  });

  it('treats a tabId-only payload as an explicit bounds clear', async () => {
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    const handler = registerAndGetHandler(IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS);

    await handler({}, { tabId: 'tab-1' });

    expect(embeddedBrowserCdp.clearTabViewBounds).toHaveBeenCalledWith('tab-1');
    expect(embeddedBrowserCdp.reportTabViewBounds).not.toHaveBeenCalled();
  });

  it('rejects non-positive dimensions via schema validation', async () => {
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    const handler = registerAndGetHandler(IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS);

    const result = await handler({}, { tabId: 'tab-1', width: 0, height: 400 });

    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(embeddedBrowserCdp.reportTabViewBounds).not.toHaveBeenCalled();
    expect(embeddedBrowserCdp.clearTabViewBounds).not.toHaveBeenCalled();
  });
});

describe('browser:set-tab-viewport IPC', () => {
  beforeEach(async () => {
    vi.mocked(ipcMain.handle).mockReset();
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    vi.mocked(embeddedBrowserCdp.setTabViewport).mockClear();
  });

  it('validates and forwards a preset viewport', async () => {
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    const handler = registerAndGetHandler(IPC_CHANNELS.BROWSER.SET_TAB_VIEWPORT);
    const viewport = { mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 };

    await expect(handler({}, { tabId: 'tab-1', viewport })).resolves.toEqual({ success: true });
    expect(embeddedBrowserCdp.setTabViewport).toHaveBeenCalledWith('tab-1', viewport);
  });

  it('rejects invalid fixed dimensions before calling the service', async () => {
    const { embeddedBrowserCdp } = await import('../embedded-browser-cdp-service');
    const handler = registerAndGetHandler(IPC_CHANNELS.BROWSER.SET_TAB_VIEWPORT);

    const result = await handler(
      {},
      {
        tabId: 'tab-1',
        viewport: { mode: 'custom', width: 0, height: 800 },
      },
    );

    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(embeddedBrowserCdp.setTabViewport).not.toHaveBeenCalled();
  });
});

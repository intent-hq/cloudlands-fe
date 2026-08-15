import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  webContents: { fromId: vi.fn() },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

import { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import { embeddedBrowserCdp } from '../embedded-browser-cdp-service';

describe('embedded browser CDP workspace routing', () => {
  const responseHandlers = new Map<string, (event: unknown, data: unknown) => unknown>();

  beforeEach(() => {
    responseHandlers.clear();
    for (const [channel, handler] of mocks.handle.mock.calls) {
      responseHandlers.set(channel, handler);
    }
    mocks.sendToWorkspaceWindows.mockReset();
  });

  it.each([undefined, null, '', 42, { workspaceId: 'ws-2' }])(
    'rejects browser close without valid workspace context: %j',
    async (workspaceId) => {
      await expect(
        embeddedBrowserCdp.closeTab('tab-1', workspaceId as unknown as string),
      ).rejects.toThrow('workspaceId is required');
      expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
    },
  );

  it('routes tab discovery and close through exact workspace-scoped channels and params', async () => {
    const responses = [
      [{ tabId: 'tab-1', url: 'https://example.test', title: 'Example' }],
      [],
      [],
      [],
    ];
    mocks.sendToWorkspaceWindows.mockImplementation(
      (workspaceId: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return;
        const tabs = responses.shift() ?? [];
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          {
            tabs,
            requestId: payload.requestId,
          },
        );
      },
    );

    await expect(embeddedBrowserCdp.closeTab('tab-1', 'ws-2')).resolves.toEqual({ tabId: 'tab-1' });

    const calls = mocks.sendToWorkspaceWindows.mock.calls;
    expect(calls[0]).toEqual([
      'ws-2',
      IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST,
      { requestId: expect.any(String), workspaceId: 'ws-2' },
    ]);
    expect(calls[1]).toEqual([
      'ws-2',
      IPC_CHANNELS.BROWSER.CLOSE_TAB,
      { tabId: 'tab-1', workspaceId: 'ws-2' },
    ]);
    expect(calls.slice(2)).toHaveLength(1);
    for (const [workspaceId, channel, payload] of calls.slice(2)) {
      expect(workspaceId).toBe('ws-2');
      expect(channel).toBe(IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST);
      expect(payload).toEqual({ requestId: expect.any(String), workspaceId: 'ws-2' });
    }
  });
});

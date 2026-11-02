import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  listAllWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  getFocusedWindowWorkspaceId: vi.fn(),
  fromWebContents: vi.fn(),
  sendToWorkspaceWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  BrowserWindow: {
    fromWebContents: mocks.fromWebContents,
  },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
  getFocusedWindowWorkspaceId: mocks.getFocusedWindowWorkspaceId,
}));

vi.mock('../../../protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    listAllWorkspaces: mocks.listAllWorkspaces,
    getWorkspace: mocks.getWorkspace,
  },
}));

vi.mock('../../../../store/main/slices/agent-events/agent-events-slice', () => ({
  agentSessionUpdated: vi.fn((payload) => ({ type: 'agent/sessionUpdated', payload })),
}));
vi.mock('../../../terminal/main/terminal.ipc', () => ({ cleanupWorkspaceTerminals: vi.fn() }));
vi.mock('../../../../shared/git/git-env', () => ({ execAsync: vi.fn() }));
vi.mock('../../../notifications/main/notification.service', () => ({
  getNotificationService: vi.fn(() => ({ start: vi.fn() })),
}));
vi.mock('../../../metadata-fs/main/metadata-fs-factory', () => ({ clearMetadataFSCache: vi.fn() }));

import { WORKSPACE_CHANNELS } from '../../../../shared/ipc/channels';
import { setupWorkspaceIPC } from '../workspace.ipc';

describe('workspace IPC read contract', () => {
  const firstWorkspace = { id: 'amber-forest', title: 'Original Title' };
  const secondWorkspace = { id: 'amber-forest', title: 'Updated Title' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.getFocusedWindowWorkspaceId.mockReturnValue('amber-forest');
    mocks.fromWebContents.mockReturnValue({ id: 1 });
    setupWorkspaceIPC();
  });

  it('wraps workspace:get-by-id results from the protocol adapter', async () => {
    mocks.getWorkspace.mockResolvedValue(firstWorkspace);

    const getByIdHandler = mocks.handlers.get(WORKSPACE_CHANNELS.GET_BY_ID);

    await expect(getByIdHandler?.({}, { workspaceId: 'amber-forest' })).resolves.toEqual({
      success: true,
      data: firstWorkspace,
    });
    expect(mocks.getWorkspace).toHaveBeenCalledWith('amber-forest');
  });

  it('wraps current-workspace reads from the protocol adapter', async () => {
    mocks.getWorkspace.mockResolvedValueOnce(secondWorkspace);

    const getCurrentHandler = mocks.handlers.get(WORKSPACE_CHANNELS.GET_CURRENT);

    await expect(getCurrentHandler?.({ sender: {} }, {})).resolves.toEqual({
      success: true,
      data: secondWorkspace,
    });
    expect(mocks.getWorkspace).toHaveBeenCalledWith('amber-forest');
  });

  it('leaves the renderer-served channels to the mock-router seeders', () => {
    for (const channel of [
      WORKSPACE_CHANNELS.LIST,
      WORKSPACE_CHANNELS.GET,
      WORKSPACE_CHANNELS.OPEN,
      WORKSPACE_CHANNELS.RENAME_BRANCH,
      WORKSPACE_CHANNELS.UPDATE_SETTINGS,
      WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
      WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
      WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
      WORKSPACE_CHANNELS.CLEAR_RECENT_REPOSITORIES,
    ]) {
      expect(mocks.handlers.has(channel), channel).toBe(false);
    }
  });
});

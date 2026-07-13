import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  listAllWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  getFocusedWindowWorkspaceId: vi.fn(),
  fromWebContents: vi.fn(),
  initRepoRegistry: vi.fn(),
  getAllRepos: vi.fn(),
  syncRepos: vi.fn(),
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

vi.mock('../change-detector-manager', () => ({
  changeDetectorManager: {
    on: vi.fn(),
    stopMonitoring: vi.fn(),
    startMonitoring: vi.fn(),
    getChangeDetector: vi.fn(),
  },
}));

vi.mock('../repo-registry', () => ({
  initRepoRegistry: mocks.initRepoRegistry,
  getAllRepos: mocks.getAllRepos,
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  syncRepos: mocks.syncRepos,
  clearRepos: vi.fn(),
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({ mainDispatch: vi.fn() }));
vi.mock('../../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice', () => ({
  workspaceFileChanges: vi.fn((payload) => ({ type: 'workspace/fileChanges', payload })),
}));
vi.mock('../../../../store/main/slices/agent-events/agent-events-slice', () => ({
  agentSessionUpdated: vi.fn((payload) => ({ type: 'agent/sessionUpdated', payload })),
}));
vi.mock('../../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: vi.fn((payload) => ({ type: 'workspace/emitEvent', payload })),
}));
vi.mock('../../../../store/main/slices/workspace-events/sagas/persistence-saga', () => ({
  deleteEventStoreForWorkspace: vi.fn(),
}));
vi.mock('../../../terminal/main/terminal.ipc', () => ({ cleanupWorkspaceTerminals: vi.fn() }));
vi.mock('../../../scripts/main/script-process-manager', () => ({ disposeScriptProcessManager: vi.fn() }));
vi.mock('../../../scripts/main/scripts-persistence', () => ({ readScripts: vi.fn(() => []) }));
vi.mock('../unified-workspace-watcher', () => ({
  getUnifiedWatcher: vi.fn(),
  shutdownUnifiedWatcher: vi.fn(),
  shutdownOtherWatchers: vi.fn(),
}));
vi.mock('../change-detection/detection.config', () => ({
  CHANGE_DETECTION_CONFIG: { gitPollingOnly: false, disableFileWatcher: false },
}));
vi.mock('../../../../shared/binary-file-extensions', () => ({ isBinaryExtension: vi.fn(() => false) }));
vi.mock('../../../agent/main/instruction-service', () => ({
  InstructionService: { getInstance: vi.fn(() => ({ warmCache: vi.fn() })) },
}));
vi.mock('../../../../shared/git/git-env', () => ({ execAsync: vi.fn() }));
vi.mock('../../../notifications/main/notification.service', () => ({
  getNotificationService: vi.fn(() => ({ start: vi.fn() })),
}));
vi.mock('../../../git/main/git.service', () => ({ GitService: vi.fn() }));
vi.mock('../../../git/main/git-router', () => ({
  getWorkspaceGitInfo: vi.fn(),
}));
vi.mock('../../../../shared/main/ssh-manager', () => ({ sshManager: {} }));
vi.mock('../../../metadata-fs/main/metadata-fs-factory', () => ({ clearMetadataFSCache: vi.fn() }));
vi.mock('../../../notes/main/notes.service', () => ({ notesService: {} }));

import { WORKSPACE_CHANNELS } from '../../../../shared/ipc/channels';
import { setupWorkspaceIPC } from '../workspace.ipc';

describe('workspace IPC read contract', () => {
  const firstWorkspace = { id: 'amber-forest', title: 'Original Title' };
  const secondWorkspace = { id: 'amber-forest', title: 'Updated Title' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.initRepoRegistry.mockResolvedValue(undefined);
    mocks.getAllRepos.mockReturnValue([]);
    mocks.getFocusedWindowWorkspaceId.mockReturnValue('amber-forest');
    mocks.fromWebContents.mockReturnValue({ id: 1 });
    setupWorkspaceIPC();
  });

  it('wraps workspace:list results without caching list data in the IPC layer', async () => {
    mocks.listAllWorkspaces
      .mockResolvedValueOnce({ ok: true, data: [firstWorkspace] })
      .mockResolvedValueOnce({ ok: true, data: [secondWorkspace] });

    const handler = mocks.handlers.get(WORKSPACE_CHANNELS.LIST);

    await expect(handler?.({}, { lite: true })).resolves.toEqual({
      success: true,
      data: [firstWorkspace],
    });
    await expect(handler?.({}, { lite: true })).resolves.toEqual({
      success: true,
      data: [secondWorkspace],
    });
    expect(mocks.listAllWorkspaces).toHaveBeenCalledTimes(2);
    expect(mocks.listAllWorkspaces).toHaveBeenNthCalledWith(1, { lite: true });
    expect(mocks.listAllWorkspaces).toHaveBeenNthCalledWith(2, { lite: true });
  });

  it('wraps workspace:get and workspace:get-by-id results from the protocol adapter', async () => {
    mocks.getWorkspace.mockResolvedValue(firstWorkspace);

    const getHandler = mocks.handlers.get(WORKSPACE_CHANNELS.GET);
    const getByIdHandler = mocks.handlers.get(WORKSPACE_CHANNELS.GET_BY_ID);

    await expect(getHandler?.({}, { id: 'amber-forest' })).resolves.toEqual({
      success: true,
      data: firstWorkspace,
    });
    await expect(getByIdHandler?.({}, { workspaceId: 'amber-forest' })).resolves.toEqual({
      success: true,
      data: firstWorkspace,
    });
    expect(mocks.getWorkspace).toHaveBeenNthCalledWith(1, 'amber-forest');
    expect(mocks.getWorkspace).toHaveBeenNthCalledWith(2, 'amber-forest');
  });

  it('wraps current-workspace reads and missing-workspace responses consistently', async () => {
    mocks.getWorkspace
      .mockResolvedValueOnce(secondWorkspace)
      .mockResolvedValueOnce(null);

    const getCurrentHandler = mocks.handlers.get(WORKSPACE_CHANNELS.GET_CURRENT);
    const getHandler = mocks.handlers.get(WORKSPACE_CHANNELS.GET);

    await expect(getCurrentHandler?.({ sender: {} }, {})).resolves.toEqual({
      success: true,
      data: secondWorkspace,
    });
    await expect(getHandler?.({}, { id: 'amber-forest' })).resolves.toEqual({
      success: false,
      error: 'Workspace not found',
    });
    expect(mocks.getWorkspace).toHaveBeenNthCalledWith(1, 'amber-forest');
    expect(mocks.getWorkspace).toHaveBeenNthCalledWith(2, 'amber-forest');
  });
});
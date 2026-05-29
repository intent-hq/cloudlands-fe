import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  syncGitIntegrationForWorkspace,
  type FileTrackingSyncGlobals,
  type GitIntegrationForSync,
} from '../main/file-tracking-sync';

const WORKSPACE_ID = 'workspace-1';

function createGlobals(): FileTrackingSyncGlobals {
  return {
    gitIntegrations: new Map(),
    gitIntegrationLocks: new Map(),
  };
}

function createIntegration(): GitIntegrationForSync {
  return {
    syncCurrentState: vi.fn().mockResolvedValue(undefined),
  };
}

describe('file-tracking sync readiness', () => {
  const logger = {
    debug: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the ready git integration and preserves forced sync behavior', async () => {
    const globals = createGlobals();
    const integration = createIntegration();
    globals.gitIntegrations?.set(WORKSPACE_ID, integration);

    const result = await syncGitIntegrationForWorkspace(WORKSPACE_ID, true, globals, logger);

    expect(result).toEqual({ success: true, synced: true });
    expect(integration.syncCurrentState).toHaveBeenCalledWith(true);
  });

  it('waits for an in-flight integration lock and re-checks integration readiness', async () => {
    const globals = createGlobals();
    const integration = createIntegration();
    let resolveLock!: () => void;
    const initLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    globals.gitIntegrationLocks?.set(WORKSPACE_ID, initLock);

    const syncPromise = syncGitIntegrationForWorkspace(WORKSPACE_ID, false, globals, logger);
    expect(integration.syncCurrentState).not.toHaveBeenCalled();

    globals.gitIntegrations?.set(WORKSPACE_ID, integration);
    resolveLock();

    await expect(syncPromise).resolves.toEqual({ success: true, synced: true });
    expect(integration.syncCurrentState).toHaveBeenCalledWith(false);
  });

  it('returns explicit not-ready when no integration exists after lock resolution', async () => {
    const globals = createGlobals();
    globals.gitIntegrationLocks?.set(WORKSPACE_ID, Promise.resolve());

    const result = await syncGitIntegrationForWorkspace(WORKSPACE_ID, false, globals, logger);

    expect(result).toEqual({
      success: false,
      notReady: true,
      code: 'GIT_INTEGRATION_NOT_READY',
      error: 'Git integration is not ready for this workspace',
    });
  });

  it('returns explicit not-ready for forced sync when readiness recovery still has no integration', async () => {
    const globals = createGlobals();
    globals.gitIntegrationLocks?.set(WORKSPACE_ID, Promise.resolve());

    const result = await syncGitIntegrationForWorkspace(WORKSPACE_ID, true, globals, logger);

    expect(result).toEqual({
      success: false,
      notReady: true,
      code: 'GIT_INTEGRATION_NOT_READY',
      error: 'Git integration is not ready for this workspace',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'No git integration found for workspace after readiness check',
      { workspaceId: WORKSPACE_ID },
    );
  });

  it('returns explicit not-ready instead of throwing when initialization rejects without integration', async () => {
    const globals = createGlobals();
    globals.gitIntegrationLocks?.set(WORKSPACE_ID, Promise.reject(new Error('init failed')));

    const result = await syncGitIntegrationForWorkspace(WORKSPACE_ID, false, globals, logger);

    expect(result.success).toBe(false);
    expect(result.notReady).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'Git integration initialization failed before sync',
      expect.objectContaining({ workspaceId: WORKSPACE_ID, error: 'init failed' }),
    );
  });
});
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the change-history-persistence rewire
 * (PROTOCOL.md §5.12). The legacy default `config` electron-store's
 * `changeHistory` bag is retired; the persistence layer now reads/writes
 * the daemon-owned `workspace.changeHistory` setting via `settings.get` /
 * `settings.update`, with an in-memory cache backing the sync API surface.
 */

const requestMock = vi.hoisted(() =>
  vi.fn(async () => ({ path: 'workspace.changeHistory', value: {} })),
);

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('change-history-persistence ↔ daemon settings.* (PROTOCOL.md §5.12)', () => {
  beforeEach(async () => {
    requestMock.mockClear();
    requestMock.mockImplementation(async () => ({
      path: 'workspace.changeHistory',
      value: {},
    }));
    vi.resetModules();
    const mod = await import('../change-history-persistence');
    mod.__resetChangeHistoryForTesting();
  });

  it('initChangeHistory hydrates the cache from settings.get', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'workspace.changeHistory',
      value: { ws1: [{ files: [], timestamp: 't' }] },
    });
    const { initChangeHistory, getChangeHistoryForWorkspace } = await import(
      '../change-history-persistence'
    );
    await initChangeHistory();
    expect(requestMock).toHaveBeenCalledWith('settings.get', {
      path: 'workspace.changeHistory',
    });
    expect(getChangeHistoryForWorkspace('ws1')).toHaveLength(1);
    expect(getChangeHistoryForWorkspace('missing')).toEqual([]);
  });

  it('setChangeHistoryForWorkspace pushes the updated map via settings.update { changes: [...] }', async () => {
    const { initChangeHistory, setChangeHistoryForWorkspace } = await import(
      '../change-history-persistence'
    );
    await initChangeHistory();
    requestMock.mockClear();
    setChangeHistoryForWorkspace('ws1', [{ files: [], timestamp: 't' } as any]);
    await flush();
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [
        {
          path: 'workspace.changeHistory',
          value: { ws1: [{ files: [], timestamp: 't' }] },
        },
      ],
    });
  });

  it('setChangeHistoryForWorkspace with empty chunks deletes the workspace entry', async () => {
    requestMock.mockResolvedValueOnce({
      path: 'workspace.changeHistory',
      value: { ws1: [{ files: [], timestamp: 't' }] },
    });
    const { initChangeHistory, setChangeHistoryForWorkspace, getAllChangeHistory } = await import(
      '../change-history-persistence'
    );
    await initChangeHistory();
    requestMock.mockClear();
    setChangeHistoryForWorkspace('ws1', []);
    await flush();
    expect(getAllChangeHistory()).toEqual({});
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'workspace.changeHistory', value: {} }],
    });
  });

  it('bulkSetChangeHistory pushes multiple workspaces in a single settings.update', async () => {
    const { initChangeHistory, bulkSetChangeHistory } = await import(
      '../change-history-persistence'
    );
    await initChangeHistory();
    requestMock.mockClear();
    bulkSetChangeHistory([
      ['ws1', [{ files: [], timestamp: 't1' } as any]],
      ['ws2', [{ files: [], timestamp: 't2' } as any]],
    ]);
    await flush();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [
        {
          path: 'workspace.changeHistory',
          value: {
            ws1: [{ files: [], timestamp: 't1' }],
            ws2: [{ files: [], timestamp: 't2' }],
          },
        },
      ],
    });
  });
});

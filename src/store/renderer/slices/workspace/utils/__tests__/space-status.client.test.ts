import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { SpaceLiveStatus } from '../space-status.types';
import { SpaceStatusClient } from '../space-status.client';

function makeStatus(workspaceId: string, computedAt: string): SpaceLiveStatus {
  return {
    workspaceId,
    taskStats: { total: 1, completed: 0, inProgress: 1 },
    changesStats: { uncommitted: 2, staged: 1, unstaged: 1 },
    lineStats: { additions: 3, deletions: 4 },
    notesStats: { total: 5, hasSpecContent: true },
    computedAt,
  };
}

describe('SpaceStatusClient invalidation coalescing', () => {
  const invoke = vi.fn();
  const client = SpaceStatusClient.getInstance();

  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    client.cleanup();
    client.invalidateAll();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        invoke,
        on: vi.fn(() => 'listener-id'),
        offById: vi.fn(),
      },
    });
  });

  afterEach(() => {
    client.cleanup();
    client.invalidateAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('marks cached status stale immediately while coalescing repeated invalidations', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: makeStatus('ws-1', 'first') });

    await expect(client.getStatus('ws-1' as WorkspaceId)).resolves.toMatchObject({
      computedAt: 'first',
    });
    expect(client.getCached('ws-1' as WorkspaceId)?.computedAt).toBe('first');

    client.invalidate('ws-1' as WorkspaceId);
    client.invalidate('ws-1' as WorkspaceId);

    expect(client.getCached('ws-1' as WorkspaceId)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValueOnce({ ok: true, data: makeStatus('ws-1', 'second') });
    await expect(client.getStatus('ws-1' as WorkspaceId)).resolves.toMatchObject({
      computedAt: 'second',
    });

    vi.runOnlyPendingTimers();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(client.getCached('ws-1' as WorkspaceId)?.computedAt).toBe('second');
  });
});


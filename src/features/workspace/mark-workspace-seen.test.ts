import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE client seam only: `$lib/client` is mocked so no request ever reaches
// the user's real daemon. The helper is fire-and-forget, so assertions flush
// the dynamic-import microtask via vi.waitFor / settled ticks.
const mockMarkSeen = vi.fn(async (_id: string) => ({ success: true }));
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { markSeen: mockMarkSeen } },
}));

import { markWorkspaceSeen } from './mark-workspace-seen';

async function flushTicks(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(() => vi.clearAllMocks());

describe('markWorkspaceSeen (explicit mark-all-read gesture)', () => {
  it('fires workspace.markSeen through the appClient seam with the workspace id', async () => {
    markWorkspaceSeen('ws-1');
    await vi.waitFor(() => expect(mockMarkSeen).toHaveBeenCalledWith('ws-1'));
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('skips route placeholder ids (new / optimistic-*) and empty ids', async () => {
    markWorkspaceSeen('new');
    markWorkspaceSeen('optimistic-123');
    markWorkspaceSeen('');
    await flushTicks();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('skips stringified undefined/null ids from transient route params', async () => {
    markWorkspaceSeen('undefined');
    markWorkspaceSeen('null');
    await flushTicks();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('is error-tolerant: a rejected mutation is swallowed (fire-and-forget)', async () => {
    mockMarkSeen.mockRejectedValueOnce(new Error('daemon offline'));
    markWorkspaceSeen('ws-1');
    await vi.waitFor(() => expect(mockMarkSeen).toHaveBeenCalledWith('ws-1'));
    // Flushing the rejection must not surface an unhandled error.
    await flushTicks();
  });
});

describe('LiveWorkspacesClient.markSeen (wire shape, fake transport)', () => {
  it('forwards workspace.markSeen with { workspaceId } per PROTOCOL §5.1 and folds success', async () => {
    vi.resetModules();
    vi.doMock('$lib/client/live/backend-transport', () => ({
      backendRequest: vi.fn(async () => ({ workspace: { id: 'ws-1', attention: 'none' } })),
      backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
      backendUnsubscribe: vi.fn(() => Promise.resolve()),
      onBackendNotification: vi.fn(() => () => {}),
    }));
    const { backendRequest } = await import('$lib/client/live/backend-transport');
    const { LiveWorkspacesClient } = await import('$lib/client/live/live-workspaces-client');

    const result = await new LiveWorkspacesClient().markSeen('ws-1');

    expect(vi.mocked(backendRequest)).toHaveBeenCalledWith('workspace.markSeen', {
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ success: true });
    vi.doUnmock('$lib/client/live/backend-transport');
  });

  it('folds a transport error into { success: false } instead of throwing', async () => {
    vi.resetModules();
    vi.doMock('$lib/client/live/backend-transport', () => ({
      backendRequest: vi.fn(async () => {
        throw new Error('socket closed');
      }),
      backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
      backendUnsubscribe: vi.fn(() => Promise.resolve()),
      onBackendNotification: vi.fn(() => () => {}),
    }));
    const { LiveWorkspacesClient } = await import('$lib/client/live/live-workspaces-client');

    const result = await new LiveWorkspacesClient().markSeen('ws-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('socket closed');
    vi.doUnmock('$lib/client/live/backend-transport');
  });
});

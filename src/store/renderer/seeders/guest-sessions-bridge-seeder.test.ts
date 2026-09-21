/**
 * Tests for the guest sessions invoke bridge seeder: in bridge-less builds the
 * `guest-sessions:list` / `guest-sessions:leave` / `guest-sessions:leave-workspace`
 * invokes resolve to shaped results (an empty list; a leave that reports the
 * session or membership gone without a host round trip) instead of rejecting
 * with UnbridgedMockIpcChannelError.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

describe('guest-sessions-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./guest-sessions-bridge-seeder');
  });

  it('resolves guest-sessions:list to an empty, token-free list', async () => {
    const result = await mockInvoke(IPC_CHANNELS.GUEST_SESSIONS.LIST);

    expect(result).toEqual({ sessions: [], openIds: [], connectedIds: [] });
  });

  it('resolves guest-sessions:leave with the id and no host-side revoke', async () => {
    const result = await mockInvoke(IPC_CHANNELS.GUEST_SESSIONS.LEAVE, { id: 'guest-1' });

    expect(result).toEqual({ id: 'guest-1', revoked: false });
  });

  it('resolves guest-sessions:leave-workspace echoing the target with no host-side leave', async () => {
    const result = await mockInvoke(IPC_CHANNELS.GUEST_SESSIONS.LEAVE_WORKSPACE, {
      id: 'guest-1',
      workspaceId: 'ws-1',
    });

    expect(result).toEqual({ id: 'guest-1', workspaceId: 'ws-1', left: false });
  });
});

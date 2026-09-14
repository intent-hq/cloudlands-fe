/**
 * Guest sessions IPC bridge — mock fallback for the multiplayer w4 channels.
 *
 * Bridges `guest-sessions:list` and `guest-sessions:leave` so the guest
 * sessions saga resolves in bridge-less builds (browser mock) and tests
 * instead of rejecting with UnbridgedMockIpcChannelError. The mock has no
 * guest session store (main owns the encrypted credentials), so the list is
 * always empty and a leave reports the session gone without a revoke.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom). Tests
 * override individual channels via `registerMockIpcHandler` after this runs.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  GuestSessionsListResult,
  LeaveGuestSessionParams,
  LeaveGuestSessionResult,
} from '$shared/types/guest-sessions';

const { GUEST_SESSIONS } = IPC_CHANNELS;

registerMockIpcHandler(GUEST_SESSIONS.LIST, async (): Promise<GuestSessionsListResult> => {
  return { sessions: [], connectedIds: [] };
});

registerMockIpcHandler(GUEST_SESSIONS.LEAVE, async (arg): Promise<LeaveGuestSessionResult> => {
  const { id } = arg as LeaveGuestSessionParams;
  return { id, revoked: false };
});

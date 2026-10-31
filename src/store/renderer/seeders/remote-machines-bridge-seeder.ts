/**
 * Remote machines IPC bridge — mock fallback for the `remote-machines:*`
 * channels.
 *
 * The expose relay lives in the main process (it briefly holds the executor
 * token), so bridge-less builds (browser mock, web renderer) have no machine
 * to mint on: expose and un-expose report the backend unsupported, and there
 * is no local machine fingerprint. Tests override individual channels via
 * `registerMockIpcHandler` after this runs.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  RemoteMachineExposeResult,
  RemoteMachineUnexposeResult,
} from '$shared/types/remote-machines';

const { REMOTE_MACHINES } = IPC_CHANNELS;

registerMockIpcHandler(REMOTE_MACHINES.EXPOSE, async (): Promise<RemoteMachineExposeResult> => ({
  success: false,
  code: 'unsupported-backend',
}));

registerMockIpcHandler(
  REMOTE_MACHINES.UNEXPOSE,
  async (): Promise<RemoteMachineUnexposeResult> => ({
    success: false,
    code: 'unsupported-backend',
  }),
);

registerMockIpcHandler(
  REMOTE_MACHINES.MACHINE_FINGERPRINT,
  async (): Promise<string | null> => null,
);

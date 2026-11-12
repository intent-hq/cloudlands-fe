/**
 * Remote machines IPC bridge — forwards the `remote-machines:*` channels to
 * the main process.
 *
 * The expose relay lives in the main process (it briefly holds the executor
 * token), so each channel hands its payload verbatim to the Electron preload
 * bridge (`window.electronAPI.invoke`) when present. Bridge-less builds
 * (browser mock, web renderer) have no machine to mint on: expose and
 * un-expose report the backend unsupported, and there is no local machine
 * fingerprint. Tests override individual channels via `registerMockIpcHandler`
 * after this runs.
 *
 * The same forwarding serves `local-pairing:*` (Add machine → Intent on this
 * computer): main reads the discovery folder and redeems codes. Bridge-less
 * builds list no Intents and cannot redeem.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { LocalIntentsListResult, LocalRedeemResult } from '$shared/types/local-pairing';
import type { NodeInviteClaimResult, NodeInviteInspectResult } from '$shared/types/node-invite';
import type {
  RemoteMachineExposeResult,
  RemoteMachineUnexposeResult,
} from '$shared/types/remote-machines';

const { LOCAL_PAIRING, REMOTE_MACHINES } = IPC_CHANNELS;

const UNSUPPORTED = { success: false, code: 'unsupported-backend' } as const;

const FALLBACKS: ReadonlyArray<[string, () => unknown]> = [
  [REMOTE_MACHINES.EXPOSE, (): RemoteMachineExposeResult => ({ ...UNSUPPORTED })],
  [REMOTE_MACHINES.UNEXPOSE, (): RemoteMachineUnexposeResult => ({ ...UNSUPPORTED })],
  [REMOTE_MACHINES.MACHINE_FINGERPRINT, (): string | null => null],
  [
    REMOTE_MACHINES.INVITE_INSPECT,
    (): NodeInviteInspectResult => ({ ok: false, code: 'not-a-link' }),
  ],
  [REMOTE_MACHINES.INVITE_CLAIM, (): NodeInviteClaimResult => ({ ok: false, code: 'failed' })],
  [REMOTE_MACHINES.INVITE_DISCARD, () => ({ ok: true })],
  [LOCAL_PAIRING.LIST, (): LocalIntentsListResult => ({ ok: true, intents: [] })],
  [LOCAL_PAIRING.REDEEM, (): LocalRedeemResult => ({ ok: false, error: { code: 'unsupported' } })],
];

for (const [channel, fallback] of FALLBACKS) {
  registerMockIpcHandler(channel, async (payload?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') return bridge.invoke(channel, payload);
    return fallback();
  });
}

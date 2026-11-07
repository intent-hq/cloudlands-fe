/**
 * Pair-link IPC bridge — forwards the `connections:pair-link-*` channels to
 * the main process, which tests the link and keeps its credential. Bridge-less
 * builds (browser mock, web renderer) cannot add a machine from a link: the
 * test and the save report a failure and nothing is kept.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { PairLinkCommitResult, PairLinkInspectResult } from '$shared/types/pair-link';

const { CONNECTIONS } = IPC_CHANNELS;

const FALLBACKS: ReadonlyArray<[string, () => unknown]> = [
  [CONNECTIONS.PAIR_LINK_INSPECT, (): PairLinkInspectResult => ({ ok: false, code: 'failed' })],
  [CONNECTIONS.PAIR_LINK_COMMIT, (): PairLinkCommitResult => ({ ok: false, code: 'failed' })],
  [CONNECTIONS.PAIR_LINK_DISCARD, () => ({ ok: true })],
];

for (const [channel, fallback] of FALLBACKS) {
  registerMockIpcHandler(channel, async (payload?: unknown) => {
    const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (bridge && typeof bridge.invoke === 'function') return bridge.invoke(channel, payload);
    return fallback();
  });
}

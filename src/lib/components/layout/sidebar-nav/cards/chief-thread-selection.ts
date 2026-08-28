import type { ChiefThreadPreview } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';

export function resolveChiefThreadOnExpansion(
  threads: readonly ChiefThreadPreview[],
  requestedAgentId: string | null,
  currentThread: ChiefThreadPreview | null,
): ChiefThreadPreview | null {
  const requestedThread = requestedAgentId
    ? threads.find((thread) => thread.agentId === requestedAgentId)
    : null;
  return requestedThread ?? currentThread;
}

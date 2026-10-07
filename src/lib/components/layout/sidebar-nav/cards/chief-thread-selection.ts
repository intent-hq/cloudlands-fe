import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';

export function resolveChiefThreadOnExpansion(
  threads: readonly ChiefThreadSummary[],
  requestedAgentId: string | null,
  currentThread: ChiefThreadSummary | null,
): ChiefThreadSummary | null {
  const requestedThread = requestedAgentId
    ? threads.find((thread) => thread.agentId === requestedAgentId)
    : null;
  return requestedThread ?? currentThread;
}

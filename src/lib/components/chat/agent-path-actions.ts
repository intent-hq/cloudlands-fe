import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import type { StoreState } from '$store/renderer/types';

/** Resolve provenance at click time, including a placement update since render. */
export function canOpenAgentPath(state: StoreState, agentId?: string | null): boolean {
  if (!agentId) return true;
  const agent = selectAgentSession.select(state, agentId);
  return !!agent && !hasNodeOwnedAgentPath(agent);
}

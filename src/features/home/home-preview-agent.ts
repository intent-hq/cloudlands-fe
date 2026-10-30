import type { AgentSession } from '$shared/types';
import { resolveLatestActiveTopLevelAgent } from '$store/renderer/slices/workspace-agents/latest-active-agent';

/** Agents the Home preview can show: not retired, deleted or awaiting deletion. */
export function homePreviewEligibleAgents(agents: AgentSession[]): AgentSession[] {
  return agents.filter(
    (agent) => !agent.retiredAt && !agent.pendingDeleteAt && agent.status !== 'deleted',
  );
}

/**
 * The Home preview's default agent: the most recently active top-level agent, locked
 * once the agent list has loaded so newer activity elsewhere does not swap the chat
 * while it is open. Create one per mounted preview; a new preview resolves afresh.
 * The lock is released, and the default resolved again, only when the locked agent
 * stops being eligible.
 */
export function createHomePreviewDefault(): (
  eligible: AgentSession[],
  loaded: boolean,
) => AgentSession | null {
  let lockedId: string | null = null;
  return (eligible, loaded) => {
    const locked = lockedId ? eligible.find((agent) => agent.id === lockedId) : undefined;
    if (locked) return locked;
    const latest = resolveLatestActiveTopLevelAgent(eligible);
    lockedId = loaded && latest ? String(latest.id) : null;
    return latest;
  };
}

/** The user's explicit Home pick while it is still eligible, otherwise the default. */
export function resolveHomePreviewAgent(
  eligible: AgentSession[],
  pickedId: string | null,
  fallback: AgentSession | null,
): AgentSession | null {
  return (pickedId && eligible.find((agent) => agent.id === pickedId)) || fallback;
}

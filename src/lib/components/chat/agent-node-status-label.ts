import type { AgentSession } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

export function getAgentNodeStatusLabel(agent?: AgentSession | null): string | undefined {
  if (agent?.status === 'halted') return m.agent_node_halted_label();
  if (agent?.status === 'resuming') return m.agent_node_resuming_label();
  if (agent?.placement && agent.effectiveIsolation === 'pending') {
    return m.agent_node_provisioning_label();
  }
  return undefined;
}

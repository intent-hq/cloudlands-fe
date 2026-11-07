import type { AgentSession } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

export function getAgentNodeStatusLabel(agent?: AgentSession | null): string | undefined {
  if (agent?.status === 'halted') return m.agent_node_halted_label();
  if (agent?.status === 'resuming') return m.agent_node_resuming_label();
  if (agent?.placement?.target === 'remote' || agent?.placement?.target === 'e2b') {
    if (agent.placementError) return m.remoteAgent_status_failed();
    if (agent.cloudStart) return m.remoteAgent_status_starting();
    if (agent.effectiveIsolation === 'pending') {
      if (agent.setup?.state === 'pending') return m.remoteAgent_status_preparingCheckout();
      if (agent.setup?.state === 'running') return m.remoteAgent_status_runningSetup();
      return m.remoteAgent_status_starting();
    }
  }
  if (agent?.placement && agent.effectiveIsolation === 'pending') {
    return m.agent_node_provisioning_label();
  }
  return undefined;
}

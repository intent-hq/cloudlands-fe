import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

const activityAt = new Date(Date.now() - 120_000).toISOString();

export const dashboardAgentFixtures = [
  {
    id: 'dashboard-coordinator',
    workspaceId: 'home-running',
    name: 'Coordinator',
    status: AgentStatus.RuntimeIdle,
    isWaitingForOtherAgents: true,
    waitingForAgentIds: ['dashboard-search', 'dashboard-keyboard', 'dashboard-verifier'],
    lastAgentResponse: 'Search and keyboard improvements are underway.',
  },
  {
    id: 'dashboard-search',
    workspaceId: 'home-running',
    name: 'Search ranking',
    parentAgentId: 'dashboard-coordinator',
    status: AgentStatus.Active,
    isResponding: true,
    turnInFlight: true,
    lastAgentResponse: 'Tuning relevance for repository matches.',
  },
  {
    id: 'dashboard-keyboard',
    workspaceId: 'home-running',
    name: 'Keyboard navigation',
    parentAgentId: 'dashboard-coordinator',
    status: AgentStatus.Active,
    isResponding: true,
    turnInFlight: true,
    lastAgentResponse: 'Keeping focus on the selected result.',
  },
  {
    id: 'dashboard-verifier',
    workspaceId: 'home-running',
    name: 'Verification',
    parentAgentId: 'dashboard-coordinator',
    status: AgentStatus.Active,
    isResponding: true,
    turnInFlight: true,
    lastAgentResponse: 'Checking the search interactions.',
  },
  {
    id: 'dashboard-review',
    workspaceId: 'home-review',
    name: 'Onboarding review',
    status: AgentStatus.RuntimeIdle,
    attentionRequestKind: 'discussion' as const,
    attentionRequestReason: 'Choose whether returning users should see the setup checklist.',
    attentionRequestTimestamp: activityAt,
  },
].map((agent) => ({
  backendSessionId: null,
  messages: [],
  createdAt: activityAt,
  updatedAt: activityAt,
  lastActivity: activityAt,
  ...agent,
  id: AgentId(agent.id),
  workspaceId: WorkspaceId(agent.workspaceId),
  parentAgentId: agent.parentAgentId ? AgentId(agent.parentAgentId) : undefined,
})) satisfies AgentSession[];

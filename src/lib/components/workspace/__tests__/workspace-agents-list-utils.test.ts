import { describe, expect, it } from 'vitest';
import * as BrandedIds from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import { getWorkspaceAgentsVisibilitySummary } from '../workspace-agents-list-utils';

function makeAgent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: BrandedIds.AgentId(id),
    backendSessionId: null,
    workspaceId: BrandedIds.WorkspaceId('workspace-1'),
    name: id,
    status: AgentStatus.Active,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('getWorkspaceAgentsVisibilitySummary', () => {
  it('counts top-level, delegated, and background agents using sidebar rules', () => {
    const agents = [
      makeAgent('coordinator'),
      makeAgent('worker-1', { metadata: { createdByAgentId: 'coordinator' } as any }),
      makeAgent('worker-2', { metadata: { createdByAgentId: 'coordinator' } as any }),
      makeAgent('background-1', { isBackground: true }),
    ];

    expect(getWorkspaceAgentsVisibilitySummary(agents)).toEqual({
      totalCount: 4,
      topLevelForegroundCount: 1,
      delegatedCount: 2,
      backgroundCount: 1,
    });
  });

  it('dedupes repeated sessions by id before counting', () => {
    const duplicate = makeAgent('agent-1');

    expect(getWorkspaceAgentsVisibilitySummary([duplicate, duplicate])).toEqual({
      totalCount: 1,
      topLevelForegroundCount: 1,
      delegatedCount: 0,
      backgroundCount: 0,
    });
  });
});

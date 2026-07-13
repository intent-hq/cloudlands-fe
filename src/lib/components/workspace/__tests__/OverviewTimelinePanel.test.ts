/**
 * Regression tests for OverviewTimelinePanel persistence across workspace switches.
 *
 * The OverviewTimelinePanel stays mounted in the sidebar when the user switches
 * workspaces. These tests verify that:
 * 1. Agent lists are correctly scoped to the active workspace
 * 2. Stale agent state from a previous workspace does not leak
 * 3. Workspace switch resets derived agent groupings (primary, delegated, other)
 *
 * Uses lightweight logic-level testing (no full Svelte mount) to mirror the
 * derived-state patterns in OverviewTimelinePanel.svelte.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';

// ── Types mirroring OverviewTimelinePanel's internal interfaces ──────────────

interface OverviewAgent {
  id: string;
  name?: string;
  specialist?: 'spec-writer' | 'implementor' | 'verifier' | 'ui-designer' | null;
  state: 'idle' | 'running' | 'responding' | 'completed' | 'failed' | 'waiting';
  isActive: boolean;
  isInitialAgent?: boolean;
  isBackground?: boolean;
  parentAgentId?: string | null;
  hasUnread?: boolean;
  digest?: string;
  statusLabel?: string;
  waitingForCount?: number;
}

// ── Derived-state helpers (mirror OverviewTimelinePanel.svelte logic) ────────

function getPrimaryAgent(agents: OverviewAgent[]): OverviewAgent | null {
  return agents.find((a) => a.isInitialAgent) || (agents.length === 1 ? agents[0] : null);
}

function getDelegatedAgentIds(agents: OverviewAgent[]): Set<string> {
  const agentIds = new Set(agents.map((a) => a.id));
  const ids = new Set<string>();
  for (const a of agents) {
    if (a.parentAgentId && agentIds.has(a.parentAgentId)) {
      ids.add(a.id);
    }
  }
  return ids;
}

function getTopLevelAgents(agents: OverviewAgent[]): OverviewAgent[] {
  const delegatedIds = getDelegatedAgentIds(agents);
  return agents.filter((a) => !a.isBackground && !delegatedIds.has(a.id));
}

function getOtherAgents(agents: OverviewAgent[]): OverviewAgent[] {
  const primary = getPrimaryAgent(agents);
  const isCoordinator = primary?.specialist === 'spec-writer';
  const others = agents.filter((a) => a !== primary && !a.isBackground);
  if (!isCoordinator || !primary) return others;
  return others.filter((a) => a.parentAgentId !== primary.id);
}

// ── Factory ─────────────────────────────────────────────────────────────────

function makeAgent(id: string, overrides: Partial<OverviewAgent> = {}): OverviewAgent {
  return {
    id,
    name: `Agent ${id}`,
    specialist: null,
    state: 'idle',
    isActive: false,
    isInitialAgent: false,
    isBackground: false,
    parentAgentId: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('OverviewTimelinePanel – persistence across workspace switches', () => {
  // ── Agent filtering after workspace switch ──────────────────────────────

  it('agent list reflects only the current workspace after a switch', () => {
    // Workspace A agents
    const wsAAgents = [
      makeAgent('coord-a', {
        isInitialAgent: true,
        specialist: 'spec-writer',
        state: 'running',
        isActive: true,
      }),
      makeAgent('impl-a1', {
        parentAgentId: 'coord-a',
        specialist: 'implementor',
        state: 'running',
        isActive: true,
      }),
      makeAgent('impl-a2', {
        parentAgentId: 'coord-a',
        specialist: 'implementor',
        state: 'idle',
        isActive: false,
      }),
    ];

    // Workspace B agents (completely different set)
    const wsBAgents = [
      makeAgent('agent-b1', { isInitialAgent: true, state: 'responding', isActive: true }),
    ];

    // Simulate: panel is mounted with workspace-A agents
    let topLevel = getTopLevelAgents(wsAAgents);
    expect(topLevel.map((a) => a.id)).toContain('coord-a');
    expect(topLevel.map((a) => a.id)).not.toContain('impl-a1'); // delegated

    // Simulate: workspace switch — panel receives workspace-B agents
    topLevel = getTopLevelAgents(wsBAgents);
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].id).toBe('agent-b1');

    // No workspace-A agents should remain
    expect(topLevel.map((a) => a.id)).not.toContain('coord-a');
    expect(topLevel.map((a) => a.id)).not.toContain('impl-a1');
  });

  it('primary agent resets correctly on workspace switch', () => {
    const wsAAgents = [
      makeAgent('coord-a', { isInitialAgent: true, specialist: 'spec-writer' }),
      makeAgent('worker-a', { parentAgentId: 'coord-a', specialist: 'implementor' }),
    ];
    const wsBAgents = [makeAgent('solo-b', { isInitialAgent: false, state: 'idle' })];

    // Workspace A: coordinator is primary
    expect(getPrimaryAgent(wsAAgents)?.id).toBe('coord-a');

    // Workspace B: single agent becomes primary (fallback logic)
    expect(getPrimaryAgent(wsBAgents)?.id).toBe('solo-b');

    // Empty workspace: no primary
    expect(getPrimaryAgent([])).toBeNull();
  });

  it('delegated agent grouping does not carry over across workspaces', () => {
    const wsAAgents = [
      makeAgent('coord-a', { isInitialAgent: true, specialist: 'spec-writer' }),
      makeAgent('del-a1', { parentAgentId: 'coord-a' }),
      makeAgent('del-a2', { parentAgentId: 'coord-a' }),
    ];

    // Workspace A: 2 delegated agents
    expect(getDelegatedAgentIds(wsAAgents).size).toBe(2);

    // Workspace B: agent with parentAgentId pointing to coord-a (stale ref)
    // Since coord-a is NOT in workspace B's agent list, it should NOT be treated as delegated
    const wsBAgents = [
      makeAgent('orphan-b', { parentAgentId: 'coord-a' }),
      makeAgent('fresh-b', {}),
    ];

    const delegatedB = getDelegatedAgentIds(wsBAgents);
    expect(delegatedB.size).toBe(0); // coord-a is not in this workspace's agents
    expect(delegatedB.has('orphan-b')).toBe(false);
  });

  // ── Coordinator "other agents" filtering ────────────────────────────────

  it('other agents list excludes coordinator-delegated agents only in coordinator mode', () => {
    const agents = [
      makeAgent('coord', { isInitialAgent: true, specialist: 'spec-writer' }),
      makeAgent('delegated-1', { parentAgentId: 'coord' }),
      makeAgent('independent-1', { parentAgentId: null }),
    ];

    const others = getOtherAgents(agents);
    // In coordinator mode, delegated agents are excluded from "other"
    expect(others.map((a) => a.id)).not.toContain('delegated-1');
    expect(others.map((a) => a.id)).toContain('independent-1');
  });

  it('background agents are excluded from other agents list', () => {
    const agents = [
      makeAgent('coord', { isInitialAgent: true, specialist: 'spec-writer' }),
      makeAgent('bg-agent', { isBackground: true }),
      makeAgent('fg-agent', {}),
    ];

    const others = getOtherAgents(agents);
    expect(others.map((a) => a.id)).not.toContain('bg-agent');
    expect(others.map((a) => a.id)).toContain('fg-agent');
  });
});

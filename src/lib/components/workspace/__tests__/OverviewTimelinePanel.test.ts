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

function getAllDescendantsOfPrimary(agents: OverviewAgent[]): Set<string> {
  const primary = getPrimaryAgent(agents);
  const isCoordinator = primary?.specialist === 'spec-writer';
  // Short-circuit: only used in coordinator branch
  if (!isCoordinator || !primary) return new Set();
  const descendants = new Set<string>();
  const queue = [primary.id];
  // Use index-based iteration to avoid O(n) shift() operations
  for (let i = 0; i < queue.length; i++) {
    const parentId = queue[i];
    for (const a of agents) {
      if (a.parentAgentId === parentId && !descendants.has(a.id)) {
        descendants.add(a.id);
        queue.push(a.id);
      }
    }
  }
  return descendants;
}

function getOtherAgents(agents: OverviewAgent[]): OverviewAgent[] {
  const primary = getPrimaryAgent(agents);
  const isCoordinator = primary?.specialist === 'spec-writer';
  const others = agents.filter((a) => a !== primary && !a.isBackground);
  if (!isCoordinator || !primary) return others;
  // In coordinator mode, exclude all agents that are delegated under any agent in the workspace
  const delegatedIds = getDelegatedAgentIds(agents);
  return others.filter((a) => !delegatedIds.has(a.id));
}

function getDelegatedCount(agents: OverviewAgent[]): number {
  return getAllDescendantsOfPrimary(agents).size;
}

function getRunningDelegatedCount(agents: OverviewAgent[]): number {
  const descendants = getAllDescendantsOfPrimary(agents);
  const delegatedAgents = agents.filter((a) => descendants.has(a.id));
  return delegatedAgents.filter((a) => a.state === 'running' || a.state === 'responding').length;
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

  // ── Regression: 2nd-tier agent filtering ────────────────────────────────

  it('grandchildren (2nd-tier delegated agents) do not appear as top-level agents', () => {
    // Coordinator → background child → foreground grandchild
    const agents = [
      makeAgent('coordinator', {
        isInitialAgent: true,
        specialist: 'spec-writer',
        isActive: true,
        state: 'running',
      }),
      makeAgent('bg-child', {
        parentAgentId: 'coordinator',
        specialist: 'implementor',
        isBackground: true, // Background child
        isActive: true,
        state: 'idle', // Idle child
      }),
      makeAgent('fg-grandchild', {
        parentAgentId: 'bg-child', // Parent is the background child
        specialist: 'verifier',
        isBackground: false, // Foreground grandchild
        isActive: true,
        state: 'running', // Running grandchild
      }),
      makeAgent('independent', {
        parentAgentId: null, // Not delegated
        isBackground: false,
        isActive: true,
        state: 'idle',
      }),
    ];

    // Top-level agents: coordinator and independent only (not grandchild)
    const topLevel = getTopLevelAgents(agents);
    expect(topLevel.map((a) => a.id)).toContain('coordinator');
    expect(topLevel.map((a) => a.id)).toContain('independent');
    expect(topLevel.map((a) => a.id)).not.toContain('bg-child'); // delegated
    expect(topLevel.map((a) => a.id)).not.toContain('fg-grandchild'); // 2nd-tier delegated

    // Other agents: independent only (grandchild excluded from "Your Agents")
    const others = getOtherAgents(agents);
    expect(others.map((a) => a.id)).toContain('independent');
    expect(others.map((a) => a.id)).not.toContain('bg-child'); // delegated
    expect(others.map((a) => a.id)).not.toContain('fg-grandchild'); // 2nd-tier delegated

    // Delegated count: includes both child and grandchild (transitive)
    const count = getDelegatedCount(agents);
    expect(count).toBe(2); // bg-child + fg-grandchild

    // Running delegated count: only the running grandchild (idle child excluded)
    const runningCount = getRunningDelegatedCount(agents);
    expect(runningCount).toBe(1); // Only fg-grandchild is running
  });

  it('orphaned agents (parent not in workspace) still appear top-level', () => {
    // Agent with parentAgentId pointing to a non-existent agent
    const agents = [
      makeAgent('coord', { isInitialAgent: true, specialist: 'spec-writer' }),
      makeAgent('orphan', { parentAgentId: 'non-existent-id' }),
    ];

    const delegatedIds = getDelegatedAgentIds(agents);
    expect(delegatedIds.has('orphan')).toBe(false); // Not delegated (parent not in workspace)

    const topLevel = getTopLevelAgents(agents);
    expect(topLevel.map((a) => a.id)).toContain('coord');
    expect(topLevel.map((a) => a.id)).toContain('orphan'); // Should appear as top-level
  });

  it('3rd-tier and deeper descendants are excluded from top-level', () => {
    // Coordinator → child → grandchild → great-grandchild
    const agents = [
      makeAgent('coord', { isInitialAgent: true, specialist: 'spec-writer' }),
      makeAgent('child', { parentAgentId: 'coord' }),
      makeAgent('grandchild', { parentAgentId: 'child' }),
      makeAgent('great-grandchild', { parentAgentId: 'grandchild' }),
    ];

    const topLevel = getTopLevelAgents(agents);
    expect(topLevel.map((a) => a.id)).toContain('coord');
    expect(topLevel.map((a) => a.id)).not.toContain('child');
    expect(topLevel.map((a) => a.id)).not.toContain('grandchild');
    expect(topLevel.map((a) => a.id)).not.toContain('great-grandchild');

    const others = getOtherAgents(agents);
    expect(others).toHaveLength(0); // All are descendants of coordinator

    const count = getDelegatedCount(agents);
    expect(count).toBe(3); // child + grandchild + great-grandchild
  });
});

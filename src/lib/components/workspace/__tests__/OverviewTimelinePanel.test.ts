/**
 * Regression tests for OverviewTimelinePanel persistence across workspace switches.
 *
 * The OverviewTimelinePanel stays mounted in the sidebar when the user switches
 * workspaces. These tests verify that:
 * 1. Agent lists are correctly scoped to the active workspace
 * 2. Stale agent state from a previous workspace does not leak
 * 3. Concurrent streaming in two workspaces remains isolated
 * 4. Workspace switch resets derived agent groupings (primary, delegated, other)
 *
 * Uses lightweight logic-level testing (no full Svelte mount) to mirror the
 * derived-state patterns in OverviewTimelinePanel.svelte.
 */

import { describe, it, expect, afterEach } from 'vitest';

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

// ── Stream listener (reused from AgentCard.streaming.test.ts pattern) ───────

function emitStreamEvent(agentId: string, detail: { type: string; content?: string }) {
  window.dispatchEvent(new CustomEvent(`agent:stream:${agentId}`, { detail }));
}

function createStreamListener(agentId: string) {
  let streamingBuffer = '';
  let isStreamActive = false;

  const handler = (event: Event) => {
    const { type, content } = (event as CustomEvent).detail || {};
    if (type === 'start') { isStreamActive = true; }
    else if (type === 'chunk' && content) { streamingBuffer += content; isStreamActive = true; }
    else if (type === 'end' || type === 'complete') { isStreamActive = false; streamingBuffer = ''; }
    else if (type === 'error') { isStreamActive = false; streamingBuffer = ''; }
  };

  const eventName = `agent:stream:${agentId}`;
  window.addEventListener(eventName, handler);

  return {
    get buffer() { return streamingBuffer; },
    get active() { return isStreamActive; },
    cleanup: () => window.removeEventListener(eventName, handler),
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

function makeAgent(
  id: string,
  overrides: Partial<OverviewAgent> = {},
): OverviewAgent {
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
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  });

  // ── Agent filtering after workspace switch ──────────────────────────────

  it('agent list reflects only the current workspace after a switch', () => {
    // Workspace A agents
    const wsAAgents = [
      makeAgent('coord-a', { isInitialAgent: true, specialist: 'spec-writer', state: 'running', isActive: true }),
      makeAgent('impl-a1', { parentAgentId: 'coord-a', specialist: 'implementor', state: 'running', isActive: true }),
      makeAgent('impl-a2', { parentAgentId: 'coord-a', specialist: 'implementor', state: 'idle', isActive: false }),
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
    const wsBAgents = [
      makeAgent('solo-b', { isInitialAgent: false, state: 'idle' }),
    ];

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

  // ── Streaming isolation for persistent panel ────────────────────────────

  it('streaming state for workspace-A agents does not leak into workspace-B panel', () => {
    // Simulate: panel is mounted, showing workspace-A agents with active streams
    const wsAStream = createStreamListener('ws-a-panel-agent');
    cleanups.push(wsAStream.cleanup);

    emitStreamEvent('ws-a-panel-agent', { type: 'start' });
    emitStreamEvent('ws-a-panel-agent', { type: 'chunk', content: 'WS-A data' });
    expect(wsAStream.active).toBe(true);
    expect(wsAStream.buffer).toBe('WS-A data');

    // Simulate: user switches to workspace-B, panel now shows workspace-B agents
    // Old listener is cleaned up (component re-renders with new agentId)
    wsAStream.cleanup();

    const wsBStream = createStreamListener('ws-b-panel-agent');
    cleanups.push(wsBStream.cleanup);

    // Workspace-B agent starts streaming
    emitStreamEvent('ws-b-panel-agent', { type: 'start' });
    emitStreamEvent('ws-b-panel-agent', { type: 'chunk', content: 'WS-B data' });

    expect(wsBStream.buffer).toBe('WS-B data');

    // Late events for workspace-A agent should not affect anything
    // (listener was cleaned up)
    emitStreamEvent('ws-a-panel-agent', { type: 'chunk', content: 'stale' });
    // wsAStream.buffer is still 'WS-A data' from before cleanup — no growth
    expect(wsAStream.buffer).toBe('WS-A data');
  });

  it('concurrent streams in two workspace panels remain fully isolated', () => {
    // Scenario: two overview panels mounted simultaneously (e.g., split view)
    const panelA = createStreamListener('panel-ws-a-agent');
    const panelB = createStreamListener('panel-ws-b-agent');
    cleanups.push(panelA.cleanup, panelB.cleanup);

    // Both start streaming
    emitStreamEvent('panel-ws-a-agent', { type: 'start' });
    emitStreamEvent('panel-ws-b-agent', { type: 'start' });

    // Interleaved chunks
    emitStreamEvent('panel-ws-a-agent', { type: 'chunk', content: 'A1' });
    emitStreamEvent('panel-ws-b-agent', { type: 'chunk', content: 'B1' });
    emitStreamEvent('panel-ws-a-agent', { type: 'chunk', content: 'A2' });
    emitStreamEvent('panel-ws-b-agent', { type: 'chunk', content: 'B2' });

    expect(panelA.buffer).toBe('A1A2');
    expect(panelB.buffer).toBe('B1B2');

    // Complete A, B keeps going
    emitStreamEvent('panel-ws-a-agent', { type: 'end' });
    expect(panelA.active).toBe(false);
    expect(panelB.active).toBe(true);

    emitStreamEvent('panel-ws-b-agent', { type: 'chunk', content: 'B3' });
    expect(panelB.buffer).toBe('B1B2B3');
    expect(panelA.buffer).toBe(''); // cleared on end
  });

  it('error in one workspace stream does not affect the other', () => {
    const panelA = createStreamListener('err-ws-a');
    const panelB = createStreamListener('err-ws-b');
    cleanups.push(panelA.cleanup, panelB.cleanup);

    emitStreamEvent('err-ws-a', { type: 'start' });
    emitStreamEvent('err-ws-b', { type: 'start' });
    emitStreamEvent('err-ws-a', { type: 'chunk', content: 'data-a' });
    emitStreamEvent('err-ws-b', { type: 'chunk', content: 'data-b' });

    // Error in workspace A
    emitStreamEvent('err-ws-a', { type: 'error' });
    expect(panelA.active).toBe(false);
    expect(panelA.buffer).toBe('');

    // Workspace B unaffected
    expect(panelB.active).toBe(true);
    expect(panelB.buffer).toBe('data-b');
  });

  // ── Rapid workspace switching ───────────────────────────────────────────

  it('rapid workspace switching does not accumulate stale listeners', () => {
    const listeners: ReturnType<typeof createStreamListener>[] = [];

    // Simulate rapid switching: mount → cleanup → mount → cleanup → mount
    for (let i = 0; i < 5; i++) {
      const listener = createStreamListener(`rapid-switch-agent-${i}`);
      listeners.push(listener);
      // Immediately clean up to simulate unmount on switch
      if (i < 4) listener.cleanup();
    }
    // Only the last listener should be active
    cleanups.push(listeners[4].cleanup);

    // Send events to all agents
    for (let i = 0; i < 5; i++) {
      emitStreamEvent(`rapid-switch-agent-${i}`, { type: 'start' });
      emitStreamEvent(`rapid-switch-agent-${i}`, { type: 'chunk', content: `data-${i}` });
    }

    // Only the last (still-mounted) listener should have received its events
    expect(listeners[4].active).toBe(true);
    expect(listeners[4].buffer).toBe('data-4');

    // Earlier listeners should not have grown (they were cleaned up)
    for (let i = 0; i < 4; i++) {
      expect(listeners[i].buffer).toBe('');
    }
  });
});


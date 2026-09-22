import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as BrandedIds from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import {
  buildWorkspaceAgentListRows,
  filterWorkspaceAgentRows,
  getDirectChildCounts,
  getFlatWorkspaceAgentRows,
  getVisibleWorkspaceAgentRows,
  shouldVirtualizeWorkspaceAgentRows,
  WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD,
  type WorkspaceAgentListRow,
  type WorkspaceAgentListRowOptions,
} from '../workspace-agents-list-utils';

const TIMESTAMP = '2026-01-01T00:00:00.000Z';

function makeAgent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: BrandedIds.AgentId(id),
    backendSessionId: null,
    workspaceId: BrandedIds.WorkspaceId('workspace-1'),
    name: id,
    status: AgentStatus.Active,
    messages: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe('getFlatWorkspaceAgentRows', () => {
  it('places delegated descendants directly after their parent at increasing depths', () => {
    const agents = [
      makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
      makeAgent('worker-1', { metadata: { createdByAgentId: 'coordinator' } as any }),
      makeAgent('nested-worker', { metadata: { createdByAgentId: 'worker-1' } as any }),
      makeAgent('standalone'),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent, depth }) => [agent.id, depth])).toEqual([
      ['coordinator', 0],
      ['worker-1', 1],
      ['nested-worker', 2],
      ['standalone', 0],
    ]);
  });

  it('nests a child keyed only by the wire parentAgentId under its parent (no createdByAgentId, §5.5)', () => {
    const agents = [
      makeAgent('coordinator'),
      makeAgent('slim-child', { parentAgentId: 'coordinator' as AgentSession['id'] }),
      makeAgent('legacy-child', { metadata: { createdByAgentId: 'coordinator' } as any }),
      makeAgent('standalone'),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent, depth }) => [agent.id, depth])).toEqual([
      ['coordinator', 0],
      ['legacy-child', 1],
      ['slim-child', 1],
      ['standalone', 0],
    ]);
  });

  it('dedupes repeated sessions by id', () => {
    const duplicate = makeAgent('agent-1');

    expect(getFlatWorkspaceAgentRows([duplicate, duplicate])).toEqual([
      { agent: duplicate, depth: 0 },
    ]);
  });

  it('keeps standalone background agents in the same top-level list', () => {
    const agents = [
      makeAgent('foreground', { updatedAt: '2026-01-01T00:00:02.000Z' }),
      makeAgent('delegated', { metadata: { createdByAgentId: 'foreground' } as any }),
      makeAgent('background', { isBackground: true, updatedAt: '2026-01-01T00:00:01.000Z' }),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent, depth }) => [agent.id, depth])).toEqual([
      ['foreground', 0],
      ['delegated', 1],
      ['background', 0],
    ]);
  });

  it('orders siblings non-idle first by recency descending, idle last', () => {
    const child = (id: string, overrides: Partial<AgentSession>) =>
      makeAgent(id, { metadata: { createdByAgentId: 'coordinator' } as any, ...overrides });
    const agents = [
      makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
      child('idle-old', { status: AgentStatus.RuntimeIdle, updatedAt: '2026-01-01T00:00:01.000Z' }),
      child('active-old', { isResponding: true, updatedAt: '2026-01-01T00:00:02.000Z' }),
      child('idle-new', { status: AgentStatus.Completed, updatedAt: '2026-01-01T00:00:04.000Z' }),
      child('active-new', { turnInFlight: true, updatedAt: '2026-01-01T00:00:03.000Z' }),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent }) => agent.id)).toEqual([
      'coordinator',
      'active-new',
      'active-old',
      'idle-new',
      'idle-old',
    ]);
  });

  it('keeps an idle coordinator above active siblings', () => {
    const agents = [
      makeAgent('standalone', { isResponding: true, updatedAt: '2026-01-01T00:00:02.000Z' }),
      makeAgent('coordinator', {
        metadata: { specialist: 'spec-writer' } as any,
        status: AgentStatus.RuntimeIdle,
        updatedAt: '2026-01-01T00:00:01.000Z',
      }),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent }) => agent.id)).toEqual([
      'coordinator',
      'standalone',
    ]);
  });

  it('sorts a parked session with lagging active flags as idle (HUD parked-wait parity)', () => {
    // The daemon can leave `status: "active"` / `isResponding: true` on an
    // agent BETWEEN turns while it holds completion watches, hooks, or PR
    // monitors — the HUD buckets those idle, and this ordering must agree.
    const child = (id: string, overrides: Partial<AgentSession>) =>
      makeAgent(id, { metadata: { createdByAgentId: 'coordinator' } as any, ...overrides });
    const agents = [
      makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
      child('parked-watch', {
        isResponding: true,
        isWaitingForOtherAgents: true,
        waitingForAgentIds: ['other'],
        updatedAt: '2026-01-01T00:00:05.000Z',
      }),
      child('parked-hooks', {
        isResponding: true,
        waitingOnHooks: [{ hookId: 'h1', name: 'CI watch' }],
        updatedAt: '2026-01-01T00:00:04.000Z',
      }),
      child('running', { isResponding: true, updatedAt: '2026-01-01T00:00:01.000Z' }),
      // A genuine in-flight turn defeats the parked-wait gate.
      child('parked-but-turning', {
        turnInFlight: true,
        isWaitingForOtherAgents: true,
        updatedAt: '2026-01-01T00:00:02.000Z',
      }),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent }) => agent.id)).toEqual([
      'coordinator',
      'parked-but-turning',
      'running',
      'parked-watch',
      'parked-hooks',
    ]);
  });

  it('keeps failed and attention-pending siblings in the non-idle partition', () => {
    const child = (id: string, overrides: Partial<AgentSession>) =>
      makeAgent(id, { metadata: { createdByAgentId: 'coordinator' } as any, ...overrides });
    const agents = [
      makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
      child('idle-newest', {
        status: AgentStatus.RuntimeIdle,
        updatedAt: '2026-01-01T00:00:05.000Z',
      }),
      child('failed', { status: AgentStatus.Error, updatedAt: '2026-01-01T00:00:01.000Z' }),
      child('blocked', {
        status: AgentStatus.RuntimeIdle,
        attentionRequestKind: 'blocker',
        updatedAt: '2026-01-01T00:00:02.000Z',
      }),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent }) => agent.id)).toEqual([
      'coordinator',
      'blocked',
      'failed',
      'idle-newest',
    ]);
  });

  it('breaks equal-recency ties by agent id so rows stay stable', () => {
    const child = (id: string) =>
      makeAgent(id, {
        metadata: { createdByAgentId: 'coordinator' } as any,
        status: AgentStatus.RuntimeIdle,
      });
    const agents = [
      makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
      child('idle-b'),
      child('idle-a'),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent }) => agent.id)).toEqual([
      'coordinator',
      'idle-a',
      'idle-b',
    ]);
  });

  it('keeps the sidebar hierarchy with compact delegated group controls', () => {
    const list = readFileSync('src/lib/components/workspace/WorkspaceAgentsList.svelte', 'utf8');
    const sidebar = readFileSync(
      'src/lib/components/workspace/MultiSelectTabbedSidebar.svelte',
      'utf8',
    );

    expect(list).toContain('data-agent-delegation-toggle={agent.id}');
    expect(list).toContain('m.workspace_agentsList_delegatedRunning_label');
    expect(list).toContain('m.workspace_overviewTimeline_yourAgents_label');
    expect(list).toContain('panelRow');
    expect(list).toContain('hidePreview');
    expect(list).not.toContain('AgentAvatarWithState');
    expect(list).toContain('<LazyAgentCard');
    expect(list).not.toContain('View agent tree');
    expect(sidebar).not.toContain('Agent orchestration');
  });
});

describe('filterWorkspaceAgentRows', () => {
  const agents = [
    makeAgent('coordinator', {
      name: 'Coordínator',
      metadata: { specialist: 'spec-writer' } as any,
    }),
    makeAgent('worker-id', {
      name: 'Worker',
      metadata: { createdByAgentId: 'coordinator', specialist: 'implementor' } as any,
    }),
    makeAgent('nested-worker', {
      name: 'Nested',
      metadata: { createdByAgentId: 'worker-id', agentType: 'verification' } as any,
    }),
    makeAgent('standalone'),
  ];
  const rows = getFlatWorkspaceAgentRows(agents);

  it('matches case and diacritics across name, specialist, role, and id', () => {
    expect(filterWorkspaceAgentRows(rows, 'coordinator').map((row) => row.agent.id)).toEqual([
      'coordinator',
    ]);
    expect(filterWorkspaceAgentRows(rows, 'IMPLEMENTOR').map((row) => row.agent.id)).toEqual([
      'coordinator',
      'worker-id',
    ]);
    expect(filterWorkspaceAgentRows(rows, 'verification').map((row) => row.agent.id)).toEqual([
      'coordinator',
      'worker-id',
      'nested-worker',
    ]);
    expect(filterWorkspaceAgentRows(rows, 'worker-id').map((row) => row.agent.id)).toEqual([
      'coordinator',
      'worker-id',
    ]);
  });

  it('keeps every ancestor of a matching descendant without changing row order', () => {
    expect(filterWorkspaceAgentRows(rows, 'nested').map((row) => row.agent.id)).toEqual([
      'coordinator',
      'worker-id',
      'nested-worker',
    ]);
    expect(filterWorkspaceAgentRows(rows, 'missing')).toEqual([]);
    expect(filterWorkspaceAgentRows(rows, '')).toEqual(rows);
  });
});

describe('getDirectChildCounts', () => {
  it('counts only direct children at each depth', () => {
    const rows = getFlatWorkspaceAgentRows([
      makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
      makeAgent('worker-1', { metadata: { createdByAgentId: 'coordinator' } as any }),
      makeAgent('nested-worker', { metadata: { createdByAgentId: 'worker-1' } as any }),
      makeAgent('worker-2', { metadata: { createdByAgentId: 'coordinator' } as any }),
      makeAgent('standalone'),
    ]);

    const counts = getDirectChildCounts(rows);
    expect(counts.get('coordinator')).toBe(2);
    expect(counts.get('worker-1')).toBe(1);
    expect(counts.has('nested-worker')).toBe(false);
    expect(counts.has('standalone')).toBe(false);
  });
});

describe('shouldVirtualizeWorkspaceAgentRows', () => {
  function makeFlatAgents(count: number): AgentSession[] {
    return Array.from({ length: count }, (_, i) => makeAgent(`agent-${i}`));
  }

  it('virtualizes flat lists above the top-level foreground threshold', () => {
    const rows = getFlatWorkspaceAgentRows(
      makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD + 1),
    );
    expect(shouldVirtualizeWorkspaceAgentRows(rows)).toBe(true);
  });

  it('keeps the regular list at or below the threshold', () => {
    const rows = getFlatWorkspaceAgentRows(
      makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD),
    );
    expect(shouldVirtualizeWorkspaceAgentRows(rows)).toBe(false);
  });

  it('still virtualizes when delegations exist (children are uniform rows of the shared row model)', () => {
    const agents = makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD + 5);
    agents.push(makeAgent('delegated', { metadata: { createdByAgentId: 'agent-0' } as any }));

    expect(shouldVirtualizeWorkspaceAgentRows(getFlatWorkspaceAgentRows(agents))).toBe(true);
  });

  it('does not count delegated children toward the threshold', () => {
    const agents = makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD);
    for (let i = 0; i < 5; i++) {
      agents.push(makeAgent(`child-${i}`, { metadata: { createdByAgentId: 'agent-0' } as any }));
    }

    expect(shouldVirtualizeWorkspaceAgentRows(getFlatWorkspaceAgentRows(agents))).toBe(false);
  });

  it('does not count background agents toward the threshold', () => {
    const agents = [...makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD)];
    for (let i = 0; i < 5; i++) {
      agents.push(makeAgent(`background-${i}`, { isBackground: true }));
    }

    expect(shouldVirtualizeWorkspaceAgentRows(getFlatWorkspaceAgentRows(agents))).toBe(false);
  });

  it('never virtualizes coordinator workspaces (section headers need the regular list)', () => {
    const agents = makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD + 5);
    agents.push(makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }));

    expect(shouldVirtualizeWorkspaceAgentRows(getFlatWorkspaceAgentRows(agents))).toBe(false);
  });

  it('renders large flat lists through VirtualList in WorkspaceAgentsList', () => {
    const list = readFileSync('src/lib/components/workspace/WorkspaceAgentsList.svelte', 'utf8');

    expect(list).toContain("import VirtualList from '$lib/components/ui/VirtualList.svelte'");
    expect(list).toContain('shouldVirtualizeWorkspaceAgentRows(filteredAgentRows)');
    expect(list).toContain('{:else if shouldUseVirtual}');
    expect(list).toContain('<VirtualList');
    expect(list).toContain('items={listRows}');
  });
});

describe('buildWorkspaceAgentListRows', () => {
  const parent = makeAgent('parent');
  const childA = makeAgent('child-a', { metadata: { createdByAgentId: 'parent' } as any });
  const childB = makeAgent('child-b', { metadata: { createdByAgentId: 'parent' } as any });
  const grandchild = makeAgent('grandchild', { metadata: { createdByAgentId: 'child-a' } as any });
  const childless = makeAgent('childless');
  const childrenOf: Record<string, AgentSession[]> = {
    parent: [childA, childB],
    'child-a': [grandchild],
  };

  function options(
    overrides: Partial<WorkspaceAgentListRowOptions> = {},
  ): WorkspaceAgentListRowOptions {
    return {
      getChildren: (id) => childrenOf[id] ?? [],
      getCountedChildren: () => undefined,
      isExpanded: () => false,
      isRunning: () => false,
      binSkeletonShown: false,
      ...overrides,
    };
  }

  const shape = (rows: WorkspaceAgentListRow[]) =>
    rows.map((row) => `${row.kind}:${row.depth}:${row.key}`);

  it('emits an agent row and a collapsed group bar per parent, nothing for a childless agent', () => {
    expect(shape(buildWorkspaceAgentListRows([parent, childless], options()))).toEqual([
      'agent:0:agent:parent',
      'delegatedGroup:0:group:parent',
      'agent:0:agent:childless',
    ]);
  });

  it('nests expanded children (and their own groups) one level deeper', () => {
    const rows = buildWorkspaceAgentListRows(
      [parent, childless],
      options({ isExpanded: (id) => id === 'parent' }),
    );
    expect(shape(rows)).toEqual([
      'agent:0:agent:parent',
      'delegatedGroup:0:group:parent',
      'agent:1:agent:child-a',
      'delegatedGroup:1:group:child-a',
      'agent:1:agent:child-b',
      'agent:0:agent:childless',
    ]);
    const group = rows[1];
    expect(group.kind === 'delegatedGroup' && group.expanded).toBe(true);
  });

  it('counts running loaded children when no daemon count is served', () => {
    const rows = buildWorkspaceAgentListRows(
      [parent],
      options({ isRunning: (id) => id === 'child-b' }),
    );
    expect(rows[1]).toMatchObject({ kind: 'delegatedGroup', total: 2, running: 1 });
  });

  it('renders a count-only group from the daemon count and skeleton rows once expanded', () => {
    const counted = options({
      getChildren: () => [],
      getCountedChildren: (id) => (id === 'parent' ? { total: 3, running: 2 } : undefined),
    });
    const collapsed = buildWorkspaceAgentListRows([parent], counted);
    expect(shape(collapsed)).toEqual(['agent:0:agent:parent', 'delegatedGroup:0:group:parent']);
    expect(collapsed[1]).toMatchObject({ total: 3, running: 2, expanded: false });

    const expanded = buildWorkspaceAgentListRows([parent], {
      ...counted,
      isExpanded: () => true,
    });
    expect(shape(expanded)).toEqual([
      'agent:0:agent:parent',
      'delegatedGroup:0:group:parent',
      'delegatedSkeleton:1:skeleton:parent:0',
      'delegatedSkeleton:1:skeleton:parent:1',
    ]);
    expect(expanded[2]).toMatchObject({ parentId: 'parent' });

    // The whole-bin skeleton replaces the per-parent one.
    expect(
      shape(
        buildWorkspaceAgentListRows([parent], {
          ...counted,
          isExpanded: () => true,
          binSkeletonShown: true,
        }),
      ),
    ).toEqual(['agent:0:agent:parent', 'delegatedGroup:0:group:parent']);
  });

  it('prefers the daemon count while children are partially loaded, then the loaded rows', () => {
    const partiallyLoaded = buildWorkspaceAgentListRows(
      [parent],
      options({
        getChildren: (id) => (id === 'parent' ? [childA] : []),
        getCountedChildren: (id) => (id === 'parent' ? { total: 4, running: 3 } : undefined),
        isExpanded: () => true,
        isRunning: () => false,
      }),
    );
    expect(partiallyLoaded[1]).toMatchObject({ total: 4, running: 3 });
    expect(shape(partiallyLoaded).slice(2)).toEqual(['agent:1:agent:child-a']);

    const loaded = buildWorkspaceAgentListRows(
      [parent],
      options({ getCountedChildren: () => undefined, isRunning: (id) => id === 'child-a' }),
    );
    expect(loaded[1]).toMatchObject({ total: 2, running: 1 });
  });
});

describe('getVisibleWorkspaceAgentRows', () => {
  const rows = getFlatWorkspaceAgentRows([
    makeAgent('coordinator', { metadata: { specialist: 'spec-writer' } as any }),
    makeAgent('worker-1', { metadata: { createdByAgentId: 'coordinator' } as any }),
    makeAgent('nested-worker', { metadata: { createdByAgentId: 'worker-1' } as any }),
    makeAgent('standalone'),
  ]);

  it('returns all rows when nothing is collapsed', () => {
    expect(getVisibleWorkspaceAgentRows(rows, new Set())).toEqual(rows);
  });

  it('hides all descendants of a collapsed agent but keeps later top-level rows', () => {
    const visible = getVisibleWorkspaceAgentRows(rows, new Set(['coordinator']));
    expect(visible.map((row) => row.agent.id)).toEqual(['coordinator', 'standalone']);
  });

  it('hides only the collapsed subtree when a mid-depth agent is collapsed', () => {
    const visible = getVisibleWorkspaceAgentRows(rows, new Set(['worker-1']));
    expect(visible.map((row) => row.agent.id)).toEqual(['coordinator', 'worker-1', 'standalone']);
  });

  it('keeps a running descendant and its ancestry visible through collapsed groups', () => {
    const visible = getVisibleWorkspaceAgentRows(
      rows,
      new Set(['coordinator', 'worker-1']),
      new Set(['nested-worker']),
    );

    expect(visible.map((row) => row.agent.id)).toEqual([
      'coordinator',
      'worker-1',
      'nested-worker',
      'standalone',
    ]);
  });

  it('defaults parent groups to collapsed until explicitly expanded', () => {
    const list = readFileSync('src/lib/components/workspace/WorkspaceAgentsList.svelte', 'utf8');

    // Per-parent groups start collapsed (default expanded only while the
    // workspace-level Delegated bin is open); an active search shows every group.
    expect(list).toContain('let toggledDelegationIds = $state(new Set<string>())');
    expect(list).toContain(
      'const delegatedGroupsDefaultExpanded = $derived(hasLazyBins && showDelegatedAgents)',
    );
    expect(list).toContain('if (hasActiveSearch) return true;');
    expect(list).toContain(
      'return toggledDelegationIds.has(agentId) !== delegatedGroupsDefaultExpanded;',
    );
    // The row model reads that state through the builder's callbacks.
    expect(list).toContain('isExpanded: isDelegationExpanded,');
    expect(list).toContain('isRunning: isAgentRunning,');
  });
});

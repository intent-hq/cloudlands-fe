import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as BrandedIds from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import {
  filterWorkspaceAgentRows,
  getDirectChildCounts,
  getFlatWorkspaceAgentRows,
  getVisibleWorkspaceAgentRows,
  shouldVirtualizeWorkspaceAgentRows,
  WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD,
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

  it('dedupes repeated sessions by id', () => {
    const duplicate = makeAgent('agent-1');

    expect(getFlatWorkspaceAgentRows([duplicate, duplicate])).toEqual([
      { agent: duplicate, depth: 0 },
    ]);
  });

  it('keeps standalone background agents in the same top-level list', () => {
    const agents = [
      makeAgent('foreground'),
      makeAgent('delegated', { metadata: { createdByAgentId: 'foreground' } as any }),
      makeAgent('background', { isBackground: true }),
    ];

    expect(getFlatWorkspaceAgentRows(agents).map(({ agent, depth }) => [agent.id, depth])).toEqual([
      ['foreground', 0],
      ['delegated', 1],
      ['background', 0],
    ]);
  });

  it('restores the legacy sidebar hierarchy and delegated group controls', () => {
    const list = readFileSync('src/lib/components/workspace/WorkspaceAgentsList.svelte', 'utf8');
    const sidebar = readFileSync(
      'src/lib/components/workspace/MultiSelectTabbedSidebar.svelte',
      'utf8',
    );

    expect(list).toContain('data-agent-delegation-toggle={agent.id}');
    expect(list).toContain('m.workspace_agentsList_delegatedRunning_label');
    expect(list).toContain('m.workspace_overviewTimeline_yourAgents_label');
    expect(list).toContain('m.workspace_overviewTimeline_coordinatorDelegates_description');
    expect(list).toContain('<LazyAgentCard');
    expect(list).not.toContain('View agent tree');
    expect(sidebar).not.toContain('Agent orchestration');
    expect(sidebar).toContain("{#if tabId !== 'agents' && tabId !== 'shell'}");
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

  it('never virtualizes when delegations exist (tree heights are variable)', () => {
    const agents = makeFlatAgents(WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD + 5);
    agents.push(makeAgent('delegated', { metadata: { createdByAgentId: 'agent-0' } as any }));

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
    expect(list).toContain('items={topLevelForegroundAgents}');
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

    expect(list).toContain('let expandedAgentIds = $state(new Set<string>())');
    expect(list).toContain('const isExpanded = hasActiveSearch || expandedAgentIds.has(agent.id)');
    expect(list).toContain('children.filter((child) => isAgentRunning(child.id))');
  });
});

import { describe, expect, it } from 'vitest';
import type { Workspace, WorkspaceDisplayStatus, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import type { StoreState } from '../../types';
import {
  initialState as workspaceInitialState,
  setWorkspaceEntity,
  workspaceReducer,
} from '../workspace/workspace-slice';
import {
  hudActivated,
  hudAttentionChanged,
  hudFeedEntryReceived,
  hudQuestionCaptured,
  hudReducer,
  initialState,
  type HudCapturedQuestion,
  type HudFeedEntry,
} from './hud-slice';
import {
  selectHudAgentStateCounts,
  selectHudAttentionItems,
  selectHudFeedItems,
  selectHudWorkspaceCards,
  selectHudWorkspaceStateBars,
} from './hud-selectors';

function makeWorkspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Workspace;
}

const RAISED_TS = '2026-07-30T12:00:00Z';

/** State with the given workspaces folded through the REAL workspace reducer. */
function mockState(
  workspaces: Workspace[],
  attention: Array<[workspaceId: string, attention: string, raisedAtTs?: string]> = [],
  feed: HudFeedEntry[] = [],
  questions: HudCapturedQuestion[] = [],
): StoreState {
  let workspaceState = workspaceInitialState;
  for (const workspace of workspaces) {
    workspaceState = workspaceReducer(workspaceState, setWorkspaceEntity(workspace));
  }
  let hudState = hudReducer(initialState, hudActivated());
  for (const [workspaceId, value, raisedAtTs] of attention) {
    hudState = hudReducer(
      hudState,
      hudAttentionChanged(workspaceId, value, raisedAtTs ?? RAISED_TS),
    );
  }
  for (const entry of feed) {
    hudState = hudReducer(hudState, hudFeedEntryReceived(entry));
  }
  for (const question of questions) {
    hudState = hudReducer(hudState, hudQuestionCaptured(question));
  }
  return { workspace: workspaceState, hud: hudState } as StoreState;
}

function withStatus(id: string, displayStatus?: WorkspaceDisplayStatus): Workspace {
  return makeWorkspace(id, displayStatus ? { displayStatus } : {});
}

describe('selectHudWorkspaceStateBars', () => {
  it("buckets the card stateKey like the mock's wsCounts (sidebar-agreeing grouping)", () => {
    const state = mockState([
      // Running (BE activity) → in_progress → PROGRESS.
      makeWorkspace('ws-1', { displayStatus: 'in_progress', activity: 'agent_running' }),
      withStatus('ws-2', 'complete'),
      withStatus('ws-3', 'pr_open'),
      withStatus('ws-4', 'pr_ready'),
      withStatus('ws-5', 'pr_merged'),
      // BE-sent statuses render verbatim (intentd#793): not_started buckets
      // as IDLE, in_progress as PROGRESS even without a running agent.
      withStatus('ws-6', 'not_started'),
      withStatus('ws-7', 'in_progress'),
      // BE-sent idle and absent displayStatus both bucket as IDLE.
      withStatus('ws-8', 'idle'),
      withStatus('ws-9'),
    ]);
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      progress: 3,
      prOpen: 2,
      prMerged: 1,
      attention: 0,
      idle: 3,
      total: 9,
    });
  });

  it('a raised live attention flag wins over the displayStatus bucket', () => {
    const state = mockState(
      [withStatus('ws-1', 'in_progress'), withStatus('ws-2', 'pr_open')],
      [['ws-1', 'review_required']],
    );
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      progress: 0,
      prOpen: 1,
      prMerged: 0,
      attention: 1,
      idle: 0,
      total: 2,
    });
  });

  it('excludes archived workspaces from every bucket', () => {
    const state = mockState([
      makeWorkspace('ws-1', { displayStatus: 'in_progress', activity: 'agent_running' }),
      makeWorkspace('ws-2', { status: WorkspaceStatus.Archived, displayStatus: 'pr_open' }),
    ]);
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      progress: 1,
      prOpen: 0,
      prMerged: 0,
      attention: 0,
      idle: 0,
      total: 1,
    });
  });
});

describe('selectHudAgentStateCounts', () => {
  it('buckets agentSummary agent statuses across workspaces', () => {
    const agentSummary = {
      count: 3,
      agentIds: ['a1', 'a2', 'a3'],
      agents: [
        { id: 'a1', name: 'Coordinator', status: 'active' },
        { id: 'a2', name: 'Implementor', status: 'waiting' },
        { id: 'a3', name: 'Verifier', status: 'error' },
      ],
    };
    const state = mockState([
      makeWorkspace('ws-1', { agentSummary: agentSummary as Workspace['agentSummary'] }),
      makeWorkspace('ws-2', {
        agentSummary: {
          count: 1,
          agentIds: ['b1'],
          agents: [{ id: 'b1', name: 'Chief', status: 'completed' }],
        } as Workspace['agentSummary'],
      }),
    ]);
    expect(selectHudAgentStateCounts.select(state)).toEqual({
      running: 1,
      waiting: 1,
      done: 1,
      failed: 1,
      idle: 0,
    });
  });
});

describe('selectHudAttentionItems', () => {
  it('surfaces waiting/failed agents with names and lastActivity as sinceTs', () => {
    const state = mockState([
      makeWorkspace('ws-1', {
        agentSummary: {
          count: 3,
          agentIds: ['a1', 'a2', 'a3'],
          agents: [
            {
              id: 'a1',
              name: 'Coordinator',
              status: 'active',
              lastActivity: '2026-07-30T11:00:00Z',
            },
            { id: 'a2', name: 'Verifier', status: 'waiting', lastActivity: '2026-07-30T11:30:00Z' },
            { id: 'a3', name: 'Developer', status: 'error', lastActivity: '2026-07-30T11:10:00Z' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    expect(selectHudAttentionItems.select(state)).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace ws-1',
        kind: 'agent_waiting',
        agentName: 'Verifier',
        message: null,
        sinceTs: '2026-07-30T11:30:00Z',
      },
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace ws-1',
        kind: 'agent_failed',
        agentName: 'Developer',
        message: null,
        sinceTs: '2026-07-30T11:10:00Z',
      },
    ]);
  });

  it('joins the captured question text onto the waiting agent row (§7.1)', () => {
    const state = mockState(
      [
        makeWorkspace('ws-1', {
          agentSummary: {
            count: 2,
            agentIds: ['a1', 'a2'],
            agents: [
              { id: 'a1', name: 'Verifier', status: 'waiting' },
              { id: 'a2', name: 'Developer', status: 'error' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [],
      [
        {
          workspaceId: 'ws-1',
          agentId: 'a1',
          header: 'Auth method',
          question: 'Which auth flow should the endpoint use?',
          ts: RAISED_TS,
        },
        {
          workspaceId: 'ws-1',
          agentId: 'a2',
          header: 'Old question',
          question: 'Failed agents never show questions',
          ts: RAISED_TS,
        },
      ],
    );
    const items = selectHudAttentionItems.select(state);
    expect(items.find((item) => item.agentName === 'Verifier')?.message).toBe(
      'Which auth flow should the endpoint use?',
    );
    expect(items.find((item) => item.agentName === 'Developer')?.message).toBeNull();
  });

  it('surfaces raised workspace attention flags with their raise time', () => {
    const state = mockState(
      [makeWorkspace('ws-1')],
      [['ws-1', 'review_required', '2026-07-30T12:34:56Z']],
    );
    expect(selectHudAttentionItems.select(state)).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace ws-1',
        kind: 'workspace_attention',
        attention: 'review_required',
        message: null,
        sinceTs: '2026-07-30T12:34:56Z',
      },
    ]);
  });

  it('drops flags for archived or unknown workspaces', () => {
    const state = mockState(
      [makeWorkspace('ws-arch', { status: WorkspaceStatus.Archived })],
      [
        ['ws-arch', 'unread'],
        ['ws-gone', 'unread'],
      ],
    );
    expect(selectHudAttentionItems.select(state)).toEqual([]);
  });

  it('sorts newest first across agent and workspace rows', () => {
    const state = mockState(
      [
        makeWorkspace('ws-1', {
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [
              {
                id: 'a1',
                name: 'Verifier',
                status: 'waiting',
                lastActivity: '2026-07-30T13:00:00Z',
              },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [['ws-1', 'unread', '2026-07-30T12:00:00Z']],
    );
    expect(selectHudAttentionItems.select(state).map((item) => item.kind)).toEqual([
      'agent_waiting',
      'workspace_attention',
    ]);
  });
});

describe('selectHudFeedItems', () => {
  function makeEntry(id: string, source: string, extra: Partial<HudFeedEntry> = {}): HudFeedEntry {
    return {
      id,
      ts: '2026-07-30T12:00:00Z',
      colorClass: 'info',
      source,
      kind: 'agent:started',
      text: '',
      ...extra,
    };
  }

  it('joins feed entries with workspace titles (null when unknown)', () => {
    const state = mockState(
      [makeWorkspace('ws-1', { title: 'Sidecar auto-update' })],
      [],
      [makeEntry('evt-1', 'ws-1'), makeEntry('evt-2', 'ws-gone')],
    );
    expect(selectHudFeedItems.select(state).map((item) => [item.id, item.workspaceTitle])).toEqual([
      ['evt-2', null],
      ['evt-1', 'Sidecar auto-update'],
    ]);
  });

  it('resolves agent names: wire agentName first, agentSummary lookup second, null never UUID', () => {
    const state = mockState(
      [
        makeWorkspace('ws-1', {
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [{ id: 'a1', name: 'Implementor', status: 'active' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [
        makeEntry('evt-1', 'ws-1', { agentId: 'a1', agentName: 'Wire Name' }),
        makeEntry('evt-2', 'ws-1', { agentId: 'a1' }),
        makeEntry('evt-3', 'ws-1', { agentId: 'gone-uuid' }),
      ],
    );
    const byId = new Map(selectHudFeedItems.select(state).map((item) => [item.id, item]));
    expect(byId.get('evt-1')?.resolvedAgentName).toBe('Wire Name');
    expect(byId.get('evt-2')?.resolvedAgentName).toBe('Implementor');
    expect(byId.get('evt-3')?.resolvedAgentName).toBeNull();
  });
});

describe('selectHudWorkspaceCards', () => {
  function cardState(
    workspaces: Workspace[],
    attention: Array<[string, string, string?]> = [],
    extra: Record<string, unknown> = {},
  ): StoreState {
    return { ...mockState(workspaces, attention), ...extra } as StoreState;
  }

  it('builds the base card from the workspace entity (zero rollups until loaded)', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        title: 'Sidecar auto-update',
        displayStatus: 'in_progress',
        activity: 'agent_running',
        repositoryOwner: 'intent-hq',
        repositoryName: 'intentd',
        prNumber: 482,
        statusMessage: 'Wiring the release-channel fetch',
      }),
    ]);
    expect(selectHudWorkspaceCards.select(state)).toEqual([
      {
        workspaceId: 'ws-1',
        title: 'Sidecar auto-update',
        repoRef: 'intent-hq/intentd',
        stateKey: 'in_progress',
        attention: null,
        statusMessage: 'Wiring the release-channel fetch',
        prNumber: 482,
        tasks: { total: 0, completed: 0, inProgress: 0 },
        tokens: 0,
        agents: [],
      },
    ]);
  });

  it('falls back to the branch when no repository is known and idle when no displayStatus', () => {
    const state = cardState([makeWorkspace('ws-1', { branch: 'feat/rpc-batching' })]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.repoRef).toBe('feat/rpc-batching');
    expect(card.stateKey).toBe('idle');
    expect(card.statusMessage).toBeNull();
    expect(card.prNumber).toBeNull();
  });

  it('keeps only live agents (running/waiting/failed) and joins last-response lines', () => {
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 4,
            agentIds: ['a1', 'a2', 'a3', 'a4'],
            agents: [
              {
                id: 'a1',
                name: 'Developer',
                status: 'active',
                lastActivity: '2026-07-30T11:00:00Z',
              },
              { id: 'a2', name: 'Verifier', status: 'waiting' },
              { id: 'a3', name: 'Spec Writer', status: 'completed' },
              { id: 'a4', name: 'Chief', status: 'error' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: { a1: { lastAgentResponse: 'vitest watch: 214 passed' } },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents).toEqual([
      {
        id: 'a1',
        name: 'Developer',
        bucket: 'running',
        lastActivityTs: '2026-07-30T11:00:00Z',
        line: 'vitest watch: 214 passed',
        parentAgentId: null,
        depth: 0,
        treePrefix: '',
        topLevel: true,
        isBackground: false,
        attentionKind: null,
        hasQuestion: false,
      },
      {
        id: 'a2',
        name: 'Verifier',
        bucket: 'waiting',
        lastActivityTs: null,
        line: null,
        parentAgentId: null,
        depth: 0,
        treePrefix: '',
        topLevel: true,
        isBackground: false,
        attentionKind: null,
        hasQuestion: false,
      },
      {
        id: 'a4',
        name: 'Chief',
        bucket: 'failed',
        lastActivityTs: null,
        line: null,
        parentAgentId: null,
        depth: 0,
        treePrefix: '',
        topLevel: true,
        isBackground: false,
        attentionKind: null,
        hasQuestion: false,
      },
    ]);
  });

  it('joins hydrated lastAgentResponse lines onto waiting and idle-summary agents too', () => {
    // Sessions carry ONLY the AgentLite hydration snapshot (agent.list §5.5
    // via bulkUpsertSessions) — no live status event ever fired in this
    // window. The line must still surface on non-running rows.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 2,
            agentIds: ['a1', 'a2'],
            agents: [
              { id: 'a1', name: 'Coordinator', status: 'waiting' },
              { id: 'a2', name: 'Implementor', status: 'active' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            a1: { status: 'waiting', lastAgentResponse: 'Waiting on the reviewer', messages: [] },
            a2: { status: 'active', lastAgentResponse: 'Porting the fetch loop', messages: [] },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket, a.line])).toEqual([
      ['a1', 'waiting', 'Waiting on the reviewer'],
      ['a2', 'running', 'Porting the fetch loop'],
    ]);
  });

  it('orders agents depth-first from parentAgentId with connector prefixes', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 4,
          agentIds: ['root', 'child-b', 'child-a', 'grandchild'],
          agents: [
            { id: 'root', name: 'Coordinator', status: 'active' },
            { id: 'child-b', name: 'Verifier', status: 'active', parentAgentId: 'root' },
            { id: 'child-a', name: 'Implementor', status: 'active', parentAgentId: 'root' },
            { id: 'grandchild', name: 'Helper', status: 'active', parentAgentId: 'child-b' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.depth, a.treePrefix])).toEqual([
      ['root', 0, ''],
      ['child-b', 1, '├─'],
      ['grandchild', 2, '│ ├─'],
      ['child-a', 1, '└─'],
    ]);
  });

  it('keeps idle ancestors of live agents so the tree stays connected', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 3,
          agentIds: ['root', 'done-branch', 'live-child'],
          agents: [
            { id: 'root', name: 'Coordinator', status: 'completed' },
            { id: 'done-branch', name: 'Spec Writer', status: 'completed', parentAgentId: 'root' },
            { id: 'live-child', name: 'Implementor', status: 'active', parentAgentId: 'root' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    // root (done) is retained because live-child sits below it; the fully-done
    // branch is dropped; the last kept child gets the closing connector.
    expect(card.agents.map((a) => [a.id, a.bucket, a.depth, a.treePrefix])).toEqual([
      ['root', 'done', 0, ''],
      ['live-child', 'running', 1, '└─'],
    ]);
  });

  it('falls back to flat wire order when parentage is absent or dangling', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 2,
          agentIds: ['a1', 'a2'],
          agents: [
            { id: 'a1', name: 'Developer', status: 'active' },
            { id: 'a2', name: 'Orphan', status: 'active', parentAgentId: 'gone' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.depth, a.parentAgentId, a.treePrefix])).toEqual([
      ['a1', 0, null, ''],
      ['a2', 0, null, ''],
    ]);
  });

  it('consumes a BE-sent in_progress verbatim even with no running agent rows (intentd#793)', () => {
    // The daemon already folds agent activity into the derivation, so a
    // BE-sent in_progress is authoritative — no local re-demotion to idle.
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 1,
          agentIds: ['a1'],
          agents: [{ id: 'a1', name: 'Coordinator', status: 'waiting' }],
        } as Workspace['agentSummary'],
      }),
    ]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
  });

  it('consumes a BE-sent idle verbatim (intentd#793)', () => {
    const state = cardState([makeWorkspace('ws-1', { displayStatus: 'idle' })]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('idle');
  });

  it('consumes a BE-sent not_started verbatim', () => {
    const state = cardState([makeWorkspace('ws-1', { displayStatus: 'not_started' })]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('not_started');
  });

  it('keeps PR states on not-running cards (never demoted to idle)', () => {
    const state = cardState([makeWorkspace('ws-1', { displayStatus: 'pr_open' })]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('pr_open');
  });

  it('a running agent overrides a BE-sent idle to in_progress', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'idle',
        agentSummary: {
          count: 1,
          agentIds: ['a1'],
          agents: [{ id: 'a1', name: 'Implementor', status: 'active' }],
        } as Workspace['agentSummary'],
      }),
    ]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
  });

  it('a running agent forces in_progress regardless of the base status', () => {
    for (const displayStatus of ['not_started', 'pr_merged', 'complete'] as const) {
      const state = cardState([
        makeWorkspace('ws-1', {
          displayStatus,
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [{ id: 'a1', name: 'Implementor', status: 'active' }],
          } as Workspace['agentSummary'],
        }),
      ]);
      expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
    }
  });

  it('workspace.activity agent_running counts as running without any agent rows', () => {
    const state = cardState([
      makeWorkspace('ws-1', { displayStatus: 'not_started', activity: 'agent_running' }),
    ]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
  });

  it('state precedence: failed agent > attention/waiting agent > displayStatus', () => {
    const failed = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'pr_open',
        agentSummary: {
          count: 2,
          agentIds: ['a1', 'a2'],
          agents: [
            { id: 'a1', name: 'Developer', status: 'error' },
            { id: 'a2', name: 'Verifier', status: 'waiting' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    expect(selectHudWorkspaceCards.select(failed)[0].stateKey).toBe('failed');

    const attention = cardState(
      [makeWorkspace('ws-1', { displayStatus: 'pr_open' })],
      [['ws-1', 'review_required']],
    );
    const [attnCard] = selectHudWorkspaceCards.select(attention);
    expect(attnCard.stateKey).toBe('wait');
    expect(attnCard.attention).toBe('review_required');
  });

  /** Workspace with one top-level and one delegated agent plus session overlays. */
  function gatedState(
    sessions: Record<string, Record<string, unknown>>,
    questions: HudCapturedQuestion[] = [],
  ): StoreState {
    const base = mockState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 2,
            agentIds: ['root', 'child'],
            agents: [
              { id: 'root', name: 'Coordinator', status: 'active' },
              { id: 'child', name: 'Implementor', status: 'active', parentAgentId: 'root' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [],
      questions,
    );
    return { ...base, agentSessions: { byAgentId: sessions, agentIdsByWorkspace: {} } } as StoreState;
  }

  it('top-level blocker attention request turns the card blocked', () => {
    const state = gatedState({
      root: { status: 'active', attentionRequestKind: 'blocker', messages: [] },
    });
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('blocked');
  });

  it('top-level discussion attention request turns the card wait (needs input)', () => {
    const state = gatedState({
      root: { status: 'active', attentionRequestKind: 'discussion', messages: [] },
    });
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('wait');
  });

  it('child-agent blocker does not flip the workspace to blocked', () => {
    const state = gatedState({
      child: { status: 'active', attentionRequestKind: 'blocker', messages: [] },
    });
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
  });

  it('background-agent discussion does not flip the workspace to wait', () => {
    const state = gatedState({
      root: {
        status: 'active',
        isBackground: true,
        attentionRequestKind: 'discussion',
        messages: [],
      },
    });
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
  });

  it('metadata.createdByAgentId marks an agent as non-top-level (blocker gated off)', () => {
    const base = mockState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 1,
          agentIds: ['a1'],
          agents: [{ id: 'a1', name: 'Helper', status: 'active' }],
        } as Workspace['agentSummary'],
      }),
    ]);
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          a1: {
            status: 'active',
            attentionRequestKind: 'blocker',
            metadata: { createdByAgentId: 'elsewhere' },
            messages: [],
          },
        },
        agentIdsByWorkspace: {},
      },
    } as StoreState;
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
  });

  it('a captured question on a waiting top-level agent turns the card wait', () => {
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      header: 'Auth method',
      question: 'Which authentication method should the endpoint use?',
      ts: '2026-07-30T12:00:00Z',
    };
    const waiting = gatedState({ root: { status: 'waiting', messages: [] } }, [question]);
    expect(selectHudWorkspaceCards.select(waiting)[0].stateKey).toBe('wait');

    // Same question on a waiting CHILD agent: gated off the workspace banner.
    const childQuestion: HudCapturedQuestion = { ...question, agentId: 'child' };
    const childWaiting = gatedState({ child: { status: 'waiting', messages: [] } }, [
      childQuestion,
    ]);
    expect(selectHudWorkspaceCards.select(childWaiting)[0].stateKey).toBe('in_progress');
  });

  it('live agent-session state wins over a stale summary status (running shows rows)', () => {
    // Summary says completed/idle (stale — refreshed only on workspace refetch),
    // but the live session slice tracks the agents as responding: the card must
    // show the agent tree rows, not fall back to the status message.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          statusMessage: 'Stale summary message',
          agentSummary: {
            count: 2,
            agentIds: ['a1', 'a2'],
            agents: [
              { id: 'a1', name: 'Coordinator', status: 'completed' },
              { id: 'a2', name: 'Implementor', status: 'idle', parentAgentId: 'a1' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            a2: { status: 'active', isResponding: true, messages: [] },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([
      ['a1', 'done'],
      ['a2', 'running'],
    ]);
  });

  it('live agent-session idle wins over a stale summary active status', () => {
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [{ id: 'a1', name: 'Coordinator', status: 'active' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            a1: {
              status: 'idle',
              isResponding: false,
              isStreaming: false,
              isProcessing: false,
              messages: [],
            },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents).toEqual([]);
  });

  it('joins the BE task stats and sums the token usage counters', () => {
    const state = cardState([makeWorkspace('ws-1', { displayStatus: 'in_progress' })], [], {
      workspaceTasks: {
        byWorkspaceId: {
          'ws-1': { stats: { total: 6, completed: 2, inProgress: 1 } },
        },
      },
      tokenUsage: {
        byWorkspaceId: {
          'ws-1': {
            totals: {
              inputTokens: 100,
              outputTokens: 40,
              cacheReadTokens: 30,
              cacheCreationTokens: 5,
            },
          },
        },
      },
    });
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.tasks).toEqual({ total: 6, completed: 2, inProgress: 1 });
    expect(card.tokens).toBe(175);
  });
});

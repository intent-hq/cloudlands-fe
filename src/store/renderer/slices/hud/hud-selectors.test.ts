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
  selectHudAttnCount,
  selectHudFeedItems,
  selectHudTakeoverView,
  selectHudWorkspaceCards,
  selectHudWorkspaceStateBars,
} from './hud-selectors';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { WorkspaceTask } from '$shared/types';

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
  it('buckets agentSummary agent statuses across workspaces (waiting-no-attention → idle)', () => {
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
      'needs-attention': 0,
      done: 1,
      failed: 1,
      idle: 1,
    });
  });

  it('a waiting agent with an outstanding question buckets needs-attention', () => {
    const state = mockState(
      [
        makeWorkspace('ws-1', {
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [{ id: 'a1', name: 'Coordinator', status: 'waiting' }],
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
      ],
    );
    expect(selectHudAgentStateCounts.select(state)['needs-attention']).toBe(1);
    expect(selectHudAgentStateCounts.select(state).idle).toBe(0);
  });
});

describe('selectHudAttnCount', () => {
  /** ws-1 with a top-level root and a delegated child, plus session overlays. */
  function attnState(
    sessions: Record<string, Record<string, unknown>>,
    attention: Array<[workspaceId: string, attention: string, raisedAtTs?: string]> = [],
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
      attention,
      [],
      questions,
    );
    return { ...base, agentSessions: { byAgentId: sessions, agentIdsByWorkspace: {} } } as StoreState;
  }

  it('is zero when only child/background agents have attention requests (regression: no phantom blink)', () => {
    // Delegated child with a pending blocker + background root with a pending
    // discussion: no card shows NEEDS INPUT/BLOCKED, so ATTN must be 0.
    const state = attnState({
      child: { status: 'active', attentionRequestKind: 'blocker', messages: [] },
      root: {
        status: 'active',
        isBackground: true,
        attentionRequestKind: 'discussion',
        messages: [],
      },
    });
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('in_progress');
    expect(selectHudAttnCount.select(state)).toBe(0);
  });

  it('counts one for a top-level pending discussion', () => {
    const state = attnState({
      root: { status: 'active', attentionRequestKind: 'discussion', messages: [] },
    });
    expect(selectHudAttnCount.select(state)).toBe(1);
  });

  it('counts a wire needs_attention rollup once when no per-agent signal covers it', () => {
    // The daemon's step-0 rollup (intentd#825) can raise needs_attention from
    // a question hold the FE never captured — the counter must still blink.
    const base = mockState([makeWorkspace('ws-1', { displayStatus: 'needs_attention' })]);
    expect(selectHudAttnCount.select(base)).toBe(1);
    // With a counted top-level agent signal the rollup adds nothing (no double count).
    const covered = {
      ...mockState([
        makeWorkspace('ws-1', {
          displayStatus: 'needs_attention',
          agentSummary: {
            count: 1,
            agentIds: ['root'],
            agents: [{ id: 'root', name: 'Coordinator', status: 'active' }],
          } as Workspace['agentSummary'],
        }),
      ]),
      agentSessions: {
        byAgentId: {
          root: { status: 'active', attentionRequestKind: 'discussion', messages: [] },
        },
        agentIdsByWorkspace: {},
      },
    } as StoreState;
    expect(selectHudAttnCount.select(covered)).toBe(1);
  });

  it('drops the count when the pending attention request is cleared', () => {
    const pending = attnState({
      root: { status: 'active', attentionRequestKind: 'discussion', messages: [] },
    });
    expect(selectHudAttnCount.select(pending)).toBe(1);
    // User-origin delivery cleared the request (§5.5): fields are gone.
    const cleared = attnState({ root: { status: 'active', messages: [] } });
    expect(selectHudAttnCount.select(cleared)).toBe(0);
  });

  it('counts a top-level blocker and a failed agent (failed is ungated)', () => {
    const blocker = attnState({
      root: { status: 'active', attentionRequestKind: 'blocker', messages: [] },
    });
    expect(selectHudAttnCount.select(blocker)).toBe(1);
    // A failed CHILD agent still counts — cardStateKey shows failed ungated.
    const failedChild = attnState({ child: { status: 'error', messages: [] } });
    expect(selectHudWorkspaceCards.select(failedChild)[0].stateKey).toBe('failed');
    expect(selectHudAttnCount.select(failedChild)).toBe(1);
  });

  it('counts an outstanding question on a waiting top-level agent, not a child', () => {
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      header: 'Auth method',
      question: 'Which authentication method should the endpoint use?',
      ts: RAISED_TS,
    };
    const topLevel = attnState({ root: { status: 'waiting', messages: [] } }, [], [question]);
    expect(selectHudAttnCount.select(topLevel)).toBe(1);
    const childQuestion: HudCapturedQuestion = { ...question, agentId: 'child' };
    const child = attnState({ child: { status: 'waiting', messages: [] } }, [], [childQuestion]);
    expect(selectHudAttnCount.select(child)).toBe(0);
  });

  it('counts a raised workspace attention flag and drops it when lowered', () => {
    const raised = attnState({}, [['ws-1', 'review_required']]);
    expect(selectHudAttnCount.select(raised)).toBe(1);
    const lowered = attnState({});
    expect(selectHudAttnCount.select(lowered)).toBe(0);
  });
});

describe('selectHudAttentionItems', () => {
  it('surfaces needs-attention/failed agents with names and lastActivity as sinceTs', () => {
    const state = mockState(
      [
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
              {
                id: 'a2',
                name: 'Verifier',
                status: 'waiting',
                lastActivity: '2026-07-30T11:30:00Z',
              },
              { id: 'a3', name: 'Developer', status: 'error', lastActivity: '2026-07-30T11:10:00Z' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [],
      [
        {
          workspaceId: 'ws-1',
          agentId: 'a2',
          header: 'Auth method',
          question: 'Which auth flow should the endpoint use?',
          ts: RAISED_TS,
        },
      ],
    );
    expect(selectHudAttentionItems.select(state)).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace ws-1',
        kind: 'agent_waiting',
        agentName: 'Verifier',
        message: 'Which auth flow should the endpoint use?',
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

  it('a merely-waiting agent (no attention) raises no row', () => {
    const state = mockState([
      makeWorkspace('ws-1', {
        agentSummary: {
          count: 1,
          agentIds: ['a1'],
          agents: [{ id: 'a1', name: 'Verifier', status: 'waiting' }],
        } as Workspace['agentSummary'],
      }),
    ]);
    expect(selectHudAttentionItems.select(state)).toEqual([]);
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
      [],
      [
        {
          workspaceId: 'ws-1',
          agentId: 'a1',
          header: 'Auth method',
          question: 'Which auth flow should the endpoint use?',
          ts: RAISED_TS,
        },
      ],
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
    questions: HudCapturedQuestion[] = [],
  ): StoreState {
    return { ...mockState(workspaces, attention, [], questions), ...extra } as StoreState;
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

  it('falls back to the branch when no repository is known and not_started when no displayStatus', () => {
    const state = cardState([makeWorkspace('ws-1', { branch: 'feat/rpc-batching' })]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.repoRef).toBe('feat/rpc-batching');
    expect(card.stateKey).toBe('not_started');
    expect(card.statusMessage).toBeNull();
    expect(card.prNumber).toBeNull();
  });

  it('keeps only live agents (running/needs-attention/failed) and joins last-response lines', () => {
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
      [
        {
          workspaceId: 'ws-1',
          agentId: 'a2',
          header: 'Auth method',
          question: 'Which auth flow should the endpoint use?',
          ts: RAISED_TS,
        },
      ],
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
        bucket: 'needs-attention',
        lastActivityTs: null,
        line: null,
        parentAgentId: null,
        depth: 0,
        treePrefix: '',
        topLevel: true,
        isBackground: false,
        attentionKind: null,
        hasQuestion: true,
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

  it('a merely-waiting agent (no attention) buckets idle and drops off the card rows', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 2,
          agentIds: ['a1', 'a2'],
          agents: [
            { id: 'a1', name: 'Developer', status: 'active' },
            { id: 'a2', name: 'Verifier', status: 'waiting' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['a1', 'running']]);
  });

  it('a pending attention request buckets the agent needs-attention (blinking yellow row)', () => {
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 2,
            agentIds: ['a1', 'a2'],
            agents: [
              { id: 'a1', name: 'Coordinator', status: 'active' },
              { id: 'a2', name: 'Implementor', status: 'idle', parentAgentId: 'a1' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            a2: { status: 'idle', attentionRequestKind: 'blocker', messages: [] },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    const row = card.agents.find((a) => a.id === 'a2');
    expect(row?.bucket).toBe('needs-attention');
    expect(row?.attentionKind).toBe('blocker');
  });

  it('joins hydrated lastAgentResponse lines onto needs-attention and idle-summary agents too', () => {
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
            a1: {
              status: 'waiting',
              attentionRequestKind: 'discussion',
              lastAgentResponse: 'Waiting on the reviewer',
              messages: [],
            },
            a2: { status: 'active', lastAgentResponse: 'Porting the fetch loop', messages: [] },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket, a.line])).toEqual([
      ['a1', 'needs-attention', 'Waiting on the reviewer'],
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

  it('never lets running agent rows override the BE status (cloudlands-fe#578)', () => {
    // The daemon owns the agent-running promotion (intentd#793); a running
    // agent row must not locally promote a BE-sent idle/pr_merged/complete.
    for (const displayStatus of ['idle', 'not_started', 'pr_merged', 'complete'] as const) {
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
      expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe(displayStatus);
    }
  });

  it('workspace.activity agent_running does not promote the BE status either', () => {
    const state = cardState([
      makeWorkspace('ws-1', { displayStatus: 'not_started', activity: 'agent_running' }),
    ]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('not_started');
  });

  it('defaults an unknown wire displayStatus to not_started (forward compat)', () => {
    const state = cardState([
      makeWorkspace('ws-1', { displayStatus: 'something_new' as never }),
    ]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('not_started');
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

  it('a wire needs_attention displayStatus renders the card as wait (BE rollup)', () => {
    // intentd#825: the daemon derives needs_attention from top-level
    // non-background agent attention/questions — the card consumes it
    // verbatim; a discussion request alone no longer flips the banner
    // locally (the daemon pushes the rollup transition instead).
    const state = mockState([makeWorkspace('ws-1', { displayStatus: 'needs_attention' })]);
    expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe('wait');
    // Without the rollup, a top-level discussion no longer flips the card —
    // the agent row still shows needs-attention (agent presentation is FE-side).
    const discussionOnly = gatedState({
      root: { status: 'active', attentionRequestKind: 'discussion', messages: [] },
    });
    const card = selectHudWorkspaceCards.select(discussionOnly)[0];
    expect(card.stateKey).toBe('in_progress');
    expect(card.agents.find((agent) => agent.id === 'root')?.bucket).toBe('needs-attention');
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

  it('a captured question marks the agent row needs-attention, not the card banner', () => {
    // The workspace banner is BE-owned (intentd#825 pushes needs_attention);
    // the per-agent presentation stays FE-side.
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      header: 'Auth method',
      question: 'Which authentication method should the endpoint use?',
      ts: '2026-07-30T12:00:00Z',
    };
    const waiting = gatedState({ root: { status: 'waiting', messages: [] } }, [question]);
    const card = selectHudWorkspaceCards.select(waiting)[0];
    expect(card.stateKey).toBe('in_progress');
    expect(card.agents.find((agent) => agent.id === 'root')?.bucket).toBe('needs-attention');

    // Same question on a waiting CHILD agent: its own row shows the state.
    const childQuestion: HudCapturedQuestion = { ...question, agentId: 'child' };
    const childWaiting = gatedState({ child: { status: 'waiting', messages: [] } }, [
      childQuestion,
    ]);
    const childCard = selectHudWorkspaceCards.select(childWaiting)[0];
    expect(childCard.stateKey).toBe('in_progress');
    expect(childCard.agents.find((agent) => agent.id === 'child')?.bucket).toBe(
      'needs-attention',
    );
  });

  it('a dismissed question stops pending on the agent row and the ATTN count', () => {
    // The captured question trails message msg-42; the waiting top-level agent
    // shows NEEDS ATTENTION until the dismissal marker arrives in metadata.
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      messageId: 'msg-42',
      header: 'Auth method',
      question: 'Which authentication method should the endpoint use?',
      ts: '2026-07-30T12:00:00Z',
    };
    const pending = gatedState({ root: { status: 'waiting', messages: [] } }, [question]);
    expect(selectHudWorkspaceCards.select(pending)[0].agents[0].hasQuestion).toBe(true);
    expect(selectHudAttnCount.select(pending)).toBe(1);

    // agent.dismissQuestions persisted dismissedQuestionsMessageId === msg-42
    // (PROTOCOL §5.5): the question is no longer pending and the ATTN count
    // drops (the daemon retires its needs_attention rollup on the same path).
    const dismissed = gatedState(
      {
        root: {
          status: 'waiting',
          metadata: { dismissedQuestionsMessageId: 'msg-42' },
          messages: [],
        },
      },
      [question],
    );
    expect(selectHudWorkspaceCards.select(dismissed)[0].agents[0].hasQuestion).toBe(false);
    expect(selectHudAttnCount.select(dismissed)).toBe(0);

    // A NEWER question (different message id) still pends despite the marker.
    const newer: HudCapturedQuestion = { ...question, messageId: 'msg-43' };
    const reraised = gatedState(
      {
        root: {
          status: 'waiting',
          metadata: { dismissedQuestionsMessageId: 'msg-42' },
          messages: [],
        },
      },
      [newer],
    );
    expect(selectHudWorkspaceCards.select(reraised)[0].agents[0].hasQuestion).toBe(true);
    expect(selectHudAttnCount.select(reraised)).toBe(1);
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


describe('selectHudTakeoverView complete-cell reports', () => {
  function takeoverState(options: {
    taskStatus?: string;
    links?: Array<{ agentId: string; createdAt: number }>;
    sessions?: Record<string, { completionReport?: string }>;
    noteContent?: string;
  }): StoreState {
    const base = mockState([makeWorkspace('ws-1', { displayStatus: 'in_progress' })]);
    const tasks = createCollection<WorkspaceTask, 'id'>('id', [
      { id: 'task-1', title: 'Port the fetch loop', status: options.taskStatus ?? 'complete' },
    ] as WorkspaceTask[]);
    return {
      ...base,
      workspaceTasks: {
        byWorkspaceId: {
          'ws-1': { tasks, stats: { total: 1, completed: 1, inProgress: 0 } },
        },
      },
      taskAgentAssociations: {
        byWorkspaceId: {
          'ws-1': {
            byNoteId: {
              'task-1': Object.fromEntries(
                (options.links ?? []).map((link) => [
                  `agent:${link.agentId}`,
                  {
                    taskText: 'Port the fetch loop',
                    taskKey: `agent:${link.agentId}`,
                    agentId: link.agentId,
                    noteId: 'task-1',
                    createdAt: link.createdAt,
                  },
                ]),
              ),
            },
          },
        },
      },
      agentSessions: {
        byAgentId: Object.fromEntries(
          Object.entries(options.sessions ?? {}).map(([agentId, session]) => [
            agentId,
            { status: 'completed', metadata: session, messages: [] },
          ]),
        ),
        agentIdsByWorkspace: {},
      },
      workspaceNotes: options.noteContent
        ? {
            byWorkspaceId: {
              'ws-1': {
                notes: createCollection('id', [
                  { id: 'task-1', title: 'Port the fetch loop', content: options.noteContent },
                ] as never[]),
              },
            },
          }
        : { byWorkspaceId: {} },
    } as StoreState;
  }

  it('fills a complete cell with the linked agent completionReport', () => {
    const state = takeoverState({
      links: [{ agentId: 'a1', createdAt: 100 }],
      sessions: { a1: { completionReport: 'Ported the loop; 12 tests green.' } },
      noteContent: 'Task note body',
    });
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.tasks[0].report).toBe('Ported the loop; 12 tests green.');
  });

  it('prefers the newest linked agent report when several links exist', () => {
    const state = takeoverState({
      links: [
        { agentId: 'a-old', createdAt: 100 },
        { agentId: 'a-new', createdAt: 200 },
      ],
      sessions: {
        'a-old': { completionReport: 'First attempt report' },
        'a-new': { completionReport: 'Final report after retry' },
      },
    });
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.tasks[0].report).toBe('Final report after retry');
  });

  it('falls back to the task note content when no linked session has a report', () => {
    const state = takeoverState({
      links: [{ agentId: 'a1', createdAt: 100 }],
      sessions: { a1: {} },
      noteContent: 'Objective: port the fetch loop.\n- keep retries',
    });
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.tasks[0].report).toBe('Objective: port the fetch loop.\n- keep retries');
  });

  it('falls back to the note content when the task has no agent links at all', () => {
    const state = takeoverState({ noteContent: 'Manually completed task body' });
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.tasks[0].report).toBe('Manually completed task body');
  });

  it('is null when neither a report nor note content exists', () => {
    const state = takeoverState({
      links: [{ agentId: 'a1', createdAt: 100 }],
      sessions: { a1: { completionReport: '   ' } },
    });
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.tasks[0].report).toBeNull();
  });

  it('is null on non-complete tasks even when a report exists', () => {
    const state = takeoverState({
      taskStatus: 'in_progress',
      links: [{ agentId: 'a1', createdAt: 100 }],
      sessions: { a1: { completionReport: 'Progress so far' } },
      noteContent: 'Task note body',
    });
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.tasks[0].report).toBeNull();
  });
});

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
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as agentSessionInitialState,
} from '../agent-session/agent-session-slice';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import { mapEventToFeedEntry } from '$features/hud/hud-feed-mapper';
import { toHudAgentStateBucket } from './hud-types';
import type { WorkspaceEvent } from '$features/events/types';

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
  it('buckets the card stateKey into the shared WORKSPACE STATS set (grid-agreeing)', () => {
    const state = mockState([
      // Running (BE activity) → in_progress → PROGRESS.
      makeWorkspace('ws-1', { displayStatus: 'in_progress', activity: 'agent_running' }),
      // complete now buckets as its own COMPLETED counter.
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
      idle: 3,
      unread: 0,
      progress: 2,
      attention: 0,
      prOpen: 2,
      prMerged: 1,
      failed: 0,
      completed: 1,
      total: 9,
    });
  });

  it('a raised live attention flag wins over the displayStatus bucket', () => {
    const state = mockState(
      [withStatus('ws-1', 'in_progress'), withStatus('ws-2', 'pr_open')],
      [['ws-1', 'review_required']],
    );
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      idle: 0,
      unread: 0,
      progress: 0,
      attention: 1,
      prOpen: 1,
      prMerged: 0,
      failed: 0,
      completed: 0,
      total: 2,
    });
  });

  it("an 'unread' flag buckets as UNREAD on idle and terminal cards, never active ones", () => {
    const state = mockState(
      [
        // Idle/absent + unread → UNREAD; in_progress + unread stays PROGRESS;
        // the terminal complete / pr_merged + unread fold to UNREAD too
        // (bar counts follow the card stateKey).
        withStatus('ws-1', 'idle'),
        withStatus('ws-2', 'in_progress'),
        withStatus('ws-3'),
        withStatus('ws-4', 'complete'),
        withStatus('ws-5', 'pr_merged'),
      ],
      [
        ['ws-1', 'unread'],
        ['ws-2', 'unread'],
        ['ws-3', 'unread'],
        ['ws-4', 'unread'],
        ['ws-5', 'unread'],
      ],
    );
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      idle: 0,
      unread: 4,
      progress: 1,
      attention: 0,
      prOpen: 0,
      prMerged: 0,
      failed: 0,
      completed: 0,
      total: 5,
    });
  });

  it('excludes archived workspaces from every bucket', () => {
    const state = mockState([
      makeWorkspace('ws-1', { displayStatus: 'in_progress', activity: 'agent_running' }),
      makeWorkspace('ws-2', { status: WorkspaceStatus.Archived, displayStatus: 'pr_open' }),
    ]);
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      idle: 0,
      unread: 0,
      progress: 1,
      attention: 0,
      prOpen: 0,
      prMerged: 0,
      failed: 0,
      completed: 0,
      total: 1,
    });
  });

  it('buckets a failed live agent into FAILED (not attention)', () => {
    const state = {
      ...mockState([
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [{ id: 'a1', name: 'Coordinator', status: 'error' }],
          } as Workspace['agentSummary'],
        }),
      ]),
    } as StoreState;
    expect(selectHudWorkspaceStateBars.select(state)).toEqual({
      idle: 0,
      unread: 0,
      progress: 0,
      attention: 0,
      prOpen: 0,
      prMerged: 0,
      failed: 1,
      completed: 0,
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

  it("never counts an 'unread' attention value (blue dot ≠ HUD attention)", () => {
    expect(selectHudAttnCount.select(attnState({}, [['ws-1', 'unread']]))).toBe(0);
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
        signal: 'question',
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

  it('carries the §5.5 attention-request signal and reason onto the agent row', () => {
    // A discussion/blocker request pends via the tracked session's
    // attention-request trio: the row names the signal (mock kind chip:
    // DISCUSSION REQUIRED / BLOCKED) and shows the reason as the detail line.
    const base = mockState([
      makeWorkspace('ws-1', {
        agentSummary: {
          count: 2,
          agentIds: ['a1', 'a2'],
          agents: [
            { id: 'a1', name: 'Coordinator', status: 'active' },
            { id: 'a2', name: 'Implementor', status: 'active' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          a1: {
            status: 'active',
            attentionRequestKind: 'discussion',
            attentionRequestReason: 'Need a call on the rollout order',
            messages: [],
          },
          a2: {
            status: 'active',
            attentionRequestKind: 'blocker',
            attentionRequestReason: 'Sandbox network is down',
            messages: [],
          },
        },
        agentIdsByWorkspace: {},
      },
    } as unknown as StoreState;
    const items = selectHudAttentionItems.select(state);
    const discussion = items.find((item) => item.agentName === 'Coordinator');
    expect(discussion?.signal).toBe('discussion');
    expect(discussion?.message).toBe('Need a call on the rollout order');
    const blocker = items.find((item) => item.agentName === 'Implementor');
    expect(blocker?.signal).toBe('blocker');
    expect(blocker?.message).toBe('Sandbox network is down');
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
        ['ws-arch', 'review_required'],
        ['ws-gone', 'review_required'],
      ],
    );
    expect(selectHudAttentionItems.select(state)).toEqual([]);
  });

  it("an 'unread' attention value raises no row (blue dot ≠ HUD attention)", () => {
    // The daemon flips `unread` on every agent turn end (§9.9); an idle
    // workspace with no pending question/blocker/discussion must not appear
    // in the ATTENTION panel because of it.
    const state = mockState([makeWorkspace('ws-1')], [['ws-1', 'unread']]);
    expect(selectHudAttentionItems.select(state)).toEqual([]);
  });

  it('a genuine question (idle agent + needs_attention rollup) raises an agent row (live bug)', () => {
    // Real wire shape of a raised coordinator question: the asking turn ends
    // (agent at lowercase `idle`), the §7.1 question was captured, and the
    // daemon pushes displayStatus needs_attention — NO workspace:attention
    // flag travels (the wire attention enum is only none|unread|
    // review_required, §9.9). The panel must show the agent row.
    const state = mockState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'needs_attention',
          agentSummary: {
            count: 1,
            agentIds: ['root'],
            agents: [
              { id: 'root', name: 'Coordinator', status: 'idle', lastActivity: RAISED_TS },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [],
      [
        {
          workspaceId: 'ws-1',
          agentId: 'root',
          messageId: 'msg-7',
          header: 'HUD test',
          question: 'Did the ATTENTION panel show a row for this workspace?',
          ts: RAISED_TS,
        },
      ],
    );
    expect(selectHudAttentionItems.select(state)).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace ws-1',
        kind: 'agent_waiting',
        signal: 'question',
        agentName: 'Coordinator',
        message: 'Did the ATTENTION panel show a row for this workspace?',
        sinceTs: RAISED_TS,
      },
    ]);
  });

  it('a needs_attention rollup no agent/flag row covers raises a generic workspace row', () => {
    // The daemon rollup is authoritative (intentd#825): a question hold the
    // FE never captured (asked before the HUD opened) must still get a row.
    const uncovered = mockState([makeWorkspace('ws-1', { displayStatus: 'needs_attention' })]);
    expect(selectHudAttentionItems.select(uncovered)).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceTitle: 'Workspace ws-1',
        kind: 'workspace_attention',
        message: null,
        sinceTs: null,
      },
    ]);
    // Covered by an agent row: the rollup adds nothing (no double row).
    const covered = mockState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'needs_attention',
          agentSummary: {
            count: 1,
            agentIds: ['root'],
            agents: [{ id: 'root', name: 'Coordinator', status: 'idle' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [],
      [
        {
          workspaceId: 'ws-1',
          agentId: 'root',
          header: 'HUD test',
          question: 'Covered by the agent row?',
          ts: RAISED_TS,
        },
      ],
    );
    expect(selectHudAttentionItems.select(covered).map((item) => item.kind)).toEqual([
      'agent_waiting',
    ]);
    // An idle displayStatus never raises the fallback row.
    const idle = mockState([makeWorkspace('ws-1', { displayStatus: 'idle' })]);
    expect(selectHudAttentionItems.select(idle)).toEqual([]);
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
      [['ws-1', 'review_required', '2026-07-30T12:00:00Z']],
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
        attentionSnippet: null,
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
        isWaitingForAgents: false,
        waitingForAgentIds: [],
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
        isWaitingForAgents: false,
        waitingForAgentIds: [],
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
        isWaitingForAgents: false,
        waitingForAgentIds: [],
      },
    ]);
  });

  it('card agent lines use the shared preview derivation (user freshness + digest)', () => {
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 2,
          agentIds: ['a1', 'a2'],
          agents: [
            { id: 'a1', name: 'Developer', status: 'active' },
            { id: 'a2', name: 'Verifier', status: 'active' },
          ],
        } as Workspace['agentSummary'],
      }),
    ], [], {
      agentSessions: {
        byAgentId: {
          // Newest transcript message is the user's → its first line previews
          // (prefixes stripped), outranking the stale lastAgentResponse.
          a1: {
            lastAgentResponse: 'Stale previous-turn summary',
            lastUserMessage: '[Currently viewing: a.ts] Please fix the panel focus',
            lastMessageRole: 'user',
          },
          // Digest outranks the persisted response (same as AgentCard).
          a2: {
            lastAgentResponse: 'Old long response',
            lastMessageRole: 'assistant',
            digest: 'Verifying panel focus fix',
          },
        },
        agentIdsByWorkspace: {},
      },
    });
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.find((agent) => agent.id === 'a1')?.line).toBe(
      'Please fix the panel focus',
    );
    expect(card.agents.find((agent) => agent.id === 'a2')?.line).toBe(
      'Verifying panel focus fix',
    );
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

  it('a waiting coordinator and its awaited children stay visible across turn boundaries', () => {
    // Live fleet case: the coordinator ended its turn to WAIT on an
    // implementor and a PR reviewer (isWaitingForOtherAgents +
    // waitingForAgentIds, §5.5). The reviewer is mid-turn; the implementor is
    // between turns (idle). A live-only row filter would empty the card —
    // the waiting coordinator and BOTH awaited children must stay visible.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 3,
            agentIds: ['coord', 'impl', 'reviewer'],
            agents: [
              { id: 'coord', name: 'Coordinator', status: 'idle' },
              { id: 'impl', name: 'Implementor', status: 'idle', parentAgentId: 'coord' },
              {
                id: 'reviewer',
                name: 'PR Reviewer',
                status: 'active',
                isResponding: true,
                parentAgentId: 'coord',
              },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            coord: {
              status: 'idle',
              isWaitingForOtherAgents: true,
              waitingForAgentIds: ['impl', 'reviewer'],
              messages: [],
            },
            impl: { status: 'idle', messages: [] },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket, a.isWaitingForAgents])).toEqual([
      ['coord', 'idle', true],
      ['impl', 'idle', false],
      ['reviewer', 'running', false],
    ]);
    expect(card.agents.find((a) => a.id === 'coord')?.waitingForAgentIds).toEqual([
      'impl',
      'reviewer',
    ]);
  });

  it('a waiting coordinator with lagging active flags buckets idle (visible but NOT running)', () => {
    // Live overshoot case: the daemon can leave `status: "active"` /
    // `isResponding: true` on a coordinator BETWEEN turns while it holds
    // completion watches (§5.5) — the card row must not render the running
    // (green/pulse) treatment nor count in RUNNING. The waiting check wins
    // over the lagging turn flags; visibility comes from
    // `keepLiveWithAncestors`, not from inflating the bucket.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'idle',
          agentSummary: {
            count: 2,
            agentIds: ['coord', 'child'],
            agents: [
              { id: 'coord', name: 'Coordinator', status: 'active', isResponding: true },
              {
                id: 'child',
                name: 'Implementor',
                status: 'active',
                isResponding: true,
                parentAgentId: 'coord',
              },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            coord: {
              status: 'active',
              isResponding: true,
              isWaitingForOtherAgents: true,
              waitingForAgentIds: ['child'],
              messages: [],
            },
            child: { status: 'active', isResponding: true, messages: [] },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    // Card rows: coordinator visible but idle; the mid-turn child runs.
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([
      ['coord', 'idle'],
      ['child', 'running'],
    ]);
    // AGENTS BY STATE counters agree: 1 running (the child), 1 idle.
    const counts = selectHudAgentStateCounts.select(state);
    expect(counts.running).toBe(1);
    expect(counts.idle).toBe(1);
    // Overlay lists partition the same buckets.
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.activeAgents.map((a) => a.id)).toEqual(['child']);
    expect(view?.idleAgents.map((a) => a.id)).toEqual(['coord']);
    // Workspace stays IDLE — a visible-but-idle waiting coordinator does not
    // flip the card state.
    expect(card.stateKey).toBe('idle');
  });

  it('a waiting coordinator genuinely streaming a turn still buckets running', () => {
    // Watches can pend while the coordinator takes its own turn — genuine
    // stream output (FE-owned isStreaming) marks running work.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 1,
            agentIds: ['coord'],
            agents: [{ id: 'coord', name: 'Coordinator', status: 'active' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            coord: {
              status: 'active',
              isStreaming: true,
              isWaitingForOtherAgents: true,
              waitingForAgentIds: ['other'],
              messages: [],
            },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['coord', 'running']]);
  });

  it('a waiting coordinator receiving the wire running transition buckets running (live bug)', () => {
    // Live HUD bug: the user messaged the Coordinator; the feed showed AGENT
    // RUNNING off `agent:status-changed` but the card square stayed grey all
    // turn. Root cause: the turn-start event carries ONLY
    // `{ agentId, status: "active", isActive: true }` (§6.5/§6.7
    // persist_status) — no waiting fields — so the frozen
    // `isWaitingForOtherAgents: true` from the previous turn's `agent:idle`
    // kept winning the bucket gate. Fold the REAL wire payload through the
    // REAL agent-session reducer and pin: bucket running; then `agent:idle`
    // (still waiting) → back to idle-but-visible.
    const runningEvent = {
      id: 'evt-run-1',
      type: 'agent:status-changed',
      timestamp: '2026-07-30T12:00:00Z',
      workspaceId: 'ws-1',
      data: { agentId: 'coord', status: 'active', isActive: true },
    } as WorkspaceEvent;
    // Seed a tracked session the way `agent.list` hydration does (the
    // reducer only folds events for tracked sessions), then replay the
    // previous turn-end `agent:idle` that froze the waiting flag (§6.5).
    let sessions = agentSessionReducer(
      agentSessionInitialState,
      bulkUpsertSessions(
        [
          {
            id: 'coord',
            workspaceId: 'ws-1',
            name: 'Coordinator',
            status: 'idle',
            messages: [],
            createdAt: '2026-07-30T00:00:00Z',
            updatedAt: '2026-07-30T00:00:00Z',
          } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
        ],
        { preserveExplicitRuntimeFlags: false },
      ),
    );
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-idle-0',
        type: 'agent:idle',
        timestamp: '2026-07-30T11:59:00Z',
        workspaceId: 'ws-1',
        data: {
          agentId: 'coord',
          status: 'idle',
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['child'],
        },
      } as WorkspaceEvent),
    );
    const workspace = makeWorkspace('ws-1', {
      displayStatus: 'in_progress',
      agentSummary: {
        count: 1,
        agentIds: ['coord'],
        agents: [{ id: 'coord', name: 'Coordinator', status: 'idle' }],
      } as Workspace['agentSummary'],
    });
    const stateOf = (agentSessions: typeof sessions): StoreState =>
      cardState([workspace], [], { agentSessions });

    // Before the transition: parked coordinator, idle-but-visible.
    let [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['coord', 'idle']]);

    // The user's message starts a turn — the wire running transition lands.
    sessions = agentSessionReducer(sessions, eventReceived('ws-1', runningEvent));
    [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['coord', 'running']]);
    // Feed↔card consistency: the same event renders an AGENT RUNNING chip
    // (status buckets running), so both pipelines agree off one source.
    const feedEntry = mapEventToFeedEntry(runningEvent);
    expect(feedEntry?.agentStatus).toBe('active');
    expect(toHudAgentStateBucket(feedEntry?.agentStatus ?? '')).toBe('running');
    // Counters agree with the card row.
    expect(selectHudAgentStateCounts.select(stateOf(sessions)).running).toBe(1);

    // Turn ends still waiting on the child → back to idle-but-visible.
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-idle-1',
        type: 'agent:idle',
        timestamp: '2026-07-30T12:05:00Z',
        workspaceId: 'ws-1',
        data: { agentId: 'coord', status: 'idle', isWaitingForOtherAgents: true },
      } as WorkspaceEvent),
    );
    [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket, a.isWaitingForAgents])).toEqual([
      ['coord', 'idle', true],
    ]);
  });

  it('the STAB-9 mid-turn agent.list re-hydration (waiting + turnInFlight) keeps the bucket running (live bug, 2nd repro)', () => {
    // Second live repro AFTER the event-fold fix: the card square STILL
    // stayed grey all turn. The event fold DID clear the frozen waiting flag
    // — but the daemon-events-bridge refires `hydrateAgentsRequested` on the
    // SAME `agent:status-changed` (STAB-9), and the fresh `agent.list`
    // AgentLite legitimately carries `isWaitingForOtherAgents: true` for the
    // WHOLE turn (the completion watch on the probe child pends through it,
    // §5.5 agent_activity_flags_for). lifecycle-read-service folds it via
    // `bulkUpsertSessions`, re-parking the coordinator as idle moments after
    // the event cleared the flag — total immunity to status events. The same
    // snapshot's STAB-125 `turnInFlight: true` (emit-time "a worker is
    // draining a turn NOW") is the orthogonal signal that must defeat the
    // waiting gate. This folds the REAL wire payloads through the REAL
    // reducer exactly as the bridge + read-service do.
    const at = (iso: string) => iso;
    let sessions = agentSessionReducer(
      agentSessionInitialState,
      bulkUpsertSessions([
        {
          id: 'coord',
          workspaceId: 'ws-1',
          name: 'Coordinator',
          status: 'idle',
          messages: [],
          createdAt: at('2026-08-02T00:00:00Z'),
          updatedAt: at('2026-08-02T00:00:00Z'),
        } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
      ]),
    );
    // Previous turn ended waiting on the probe child (§6.5 froze the flag).
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-idle-0',
        type: 'agent:idle',
        timestamp: at('2026-08-02T11:59:00Z'),
        workspaceId: 'ws-1',
        data: {
          agentId: 'coord',
          status: 'idle',
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['probe'],
        },
      } as WorkspaceEvent),
    );
    // User message starts a turn: the wire running transition lands…
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-run-2',
        type: 'agent:status-changed',
        timestamp: at('2026-08-02T12:00:00Z'),
        workspaceId: 'ws-1',
        data: { agentId: 'coord', status: 'active', isActive: true },
      } as WorkspaceEvent),
    );
    // …and the STAB-9 refetch the bridge fired off the SAME event resolves
    // with the PROTOCOL §5.5 AgentLite: watches still pending (waiting true)
    // AND the turn-liveness pair reporting the in-flight turn.
    sessions = agentSessionReducer(
      sessions,
      bulkUpsertSessions([
        {
          id: 'coord',
          workspaceId: 'ws-1',
          name: 'Coordinator',
          status: 'active',
          isActive: true,
          isStreaming: false,
          isProcessing: false,
          isResponding: true,
          isWaitingOnTool: false,
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['probe'],
          turnInFlight: true,
          lastStreamActivityAt: at('2026-08-02T12:00:01Z'),
          messages: [],
          createdAt: at('2026-08-02T00:00:00Z'),
          updatedAt: at('2026-08-02T12:00:01Z'),
          metadata: { isBackground: false },
        } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
      ]),
    );
    const workspace = makeWorkspace('ws-1', {
      displayStatus: 'in_progress',
      agentSummary: {
        count: 1,
        agentIds: ['coord'],
        agents: [{ id: 'coord', name: 'Coordinator', status: 'active' }],
      } as Workspace['agentSummary'],
    });
    const stateOf = (agentSessions: typeof sessions): StoreState =>
      cardState([workspace], [], { agentSessions });

    let [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['coord', 'running']]);
    expect(selectHudAgentStateCounts.select(stateOf(sessions)).running).toBe(1);

    // Turn end: idle event, then the post-idle STAB-9 snapshot (turn slot
    // closed → turnInFlight false, watch still pending) → idle-but-visible.
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-idle-1',
        type: 'agent:idle',
        timestamp: at('2026-08-02T12:05:00Z'),
        workspaceId: 'ws-1',
        data: { agentId: 'coord', status: 'idle', isWaitingForOtherAgents: true },
      } as WorkspaceEvent),
    );
    sessions = agentSessionReducer(
      sessions,
      bulkUpsertSessions([
        {
          id: 'coord',
          workspaceId: 'ws-1',
          name: 'Coordinator',
          status: 'idle',
          isActive: false,
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
          isWaitingOnTool: false,
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['probe'],
          turnInFlight: false,
          messages: [],
          createdAt: at('2026-08-02T00:00:00Z'),
          updatedAt: at('2026-08-02T12:05:00Z'),
          metadata: { isBackground: false },
        } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
      ]),
    );
    [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket, a.isWaitingForAgents])).toEqual([
      ['coord', 'idle', true],
    ]);
  });

  it('the racy STAB-9 re-hydration (waiting + turnInFlight:FALSE) cannot re-park a just-started turn (live bug, 3rd repro)', () => {
    // Third live repro: the square flicked GREEN momentarily then went grey
    // for the rest of the turn. The event fold worked — but the daemon emits
    // the turn-start `agent:status-changed` BEFORE opening the STAB-125
    // live-turn slot (agent_manager: try_begin → persist_status(Active) →
    // run_prompt_turn → begin_live_turn), so the STAB-9 refetch fired off
    // that very event can resolve with `isWaitingForOtherAgents: true` AND
    // `turnInFlight: false` — a snapshot that looks exactly like a parked
    // coordinator. The gate must not trust that single racy field: the
    // slice's sticky FE-owned `liveTurnOpen` slot (opened by the running
    // event, closed only by an explicit idle/isActive:false signal) keeps
    // the bucket running through it.
    const at = (iso: string) => iso;
    let sessions = agentSessionReducer(
      agentSessionInitialState,
      bulkUpsertSessions([
        {
          id: 'coord',
          workspaceId: 'ws-1',
          name: 'Coordinator',
          status: 'idle',
          messages: [],
          createdAt: at('2026-08-02T00:00:00Z'),
          updatedAt: at('2026-08-02T00:00:00Z'),
        } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
      ]),
    );
    // Seed: previous turn ended waiting on the probe child.
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-idle-0',
        type: 'agent:idle',
        timestamp: at('2026-08-02T11:59:00Z'),
        workspaceId: 'ws-1',
        data: {
          agentId: 'coord',
          status: 'idle',
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['probe'],
        },
      } as WorkspaceEvent),
    );
    // Turn start event lands (fold clears the waiting flag, opens the slot)…
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-run-3',
        type: 'agent:status-changed',
        timestamp: at('2026-08-02T12:00:00Z'),
        workspaceId: 'ws-1',
        data: { agentId: 'coord', status: 'active', isActive: true },
      } as WorkspaceEvent),
    );
    // …then THE RACE: the refetch that event triggered resolves from a
    // moment before begin_live_turn — waiting re-asserted, turnInFlight
    // still false.
    sessions = agentSessionReducer(
      sessions,
      bulkUpsertSessions([
        {
          id: 'coord',
          workspaceId: 'ws-1',
          name: 'Coordinator',
          status: 'active',
          isActive: true,
          isStreaming: false,
          isProcessing: false,
          isResponding: true,
          isWaitingOnTool: false,
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['probe'],
          turnInFlight: false,
          messages: [],
          createdAt: at('2026-08-02T00:00:00Z'),
          updatedAt: at('2026-08-02T12:00:01Z'),
          metadata: { isBackground: false },
        } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
      ]),
    );
    const workspace = makeWorkspace('ws-1', {
      displayStatus: 'in_progress',
      agentSummary: {
        count: 1,
        agentIds: ['coord'],
        agents: [{ id: 'coord', name: 'Coordinator', status: 'active' }],
      } as Workspace['agentSummary'],
    });
    const stateOf = (agentSessions: typeof sessions): StoreState =>
      cardState([workspace], [], { agentSessions });

    // Bucket must STAY RUNNING — no green→grey flip.
    let [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['coord', 'running']]);
    expect(selectHudAgentStateCounts.select(stateOf(sessions)).running).toBe(1);

    // Explicit turn end: agent:idle closes the slot → the waiting gate
    // resumes → idle-but-visible.
    sessions = agentSessionReducer(
      sessions,
      eventReceived('ws-1', {
        id: 'evt-idle-1',
        type: 'agent:idle',
        timestamp: at('2026-08-02T12:05:00Z'),
        workspaceId: 'ws-1',
        data: { agentId: 'coord', status: 'idle', isWaitingForOtherAgents: true },
      } as WorkspaceEvent),
    );
    [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket, a.isWaitingForAgents])).toEqual([
      ['coord', 'idle', true],
    ]);

    // Post-idle hydration with isActive: false while no turn is open must
    // not resurrect anything — stays idle.
    sessions = agentSessionReducer(
      sessions,
      bulkUpsertSessions([
        {
          id: 'coord',
          workspaceId: 'ws-1',
          name: 'Coordinator',
          status: 'idle',
          isActive: false,
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
          isWaitingOnTool: false,
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['probe'],
          turnInFlight: false,
          messages: [],
          createdAt: at('2026-08-02T00:00:00Z'),
          updatedAt: at('2026-08-02T12:05:01Z'),
          metadata: { isBackground: false },
        } as unknown as Parameters<typeof bulkUpsertSessions>[0][number],
      ]),
    );
    [card] = selectHudWorkspaceCards.select(stateOf(sessions));
    expect(card.agents.map((a) => [a.id, a.bucket, a.isWaitingForAgents])).toEqual([
      ['coord', 'idle', true],
    ]);
  });

  it('a failed session with stale watch fields still buckets failed', () => {
    // Terminal statuses win over leftover completion-watch fields.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 1,
            agentIds: ['coord'],
            agents: [{ id: 'coord', name: 'Coordinator', status: 'error' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            coord: {
              status: 'error',
              isWaitingForOtherAgents: true,
              waitingForAgentIds: ['other'],
              messages: [],
            },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.bucket])).toEqual([['coord', 'failed']]);
  });

  it('a summary-only waiting coordinator with no live children still keeps no rows (no session data)', () => {
    // Without the tracked session's waitingForAgentIds there is no waiting
    // signal — a genuinely all-idle workspace still collapses to no rows.
    const state = cardState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: 2,
          agentIds: ['coord', 'impl'],
          agents: [
            { id: 'coord', name: 'Coordinator', status: 'idle' },
            { id: 'impl', name: 'Implementor', status: 'idle', parentAgentId: 'coord' },
          ],
        } as Workspace['agentSummary'],
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents).toEqual([]);
  });

  it('an awaited child keeps its idle ancestors visible for tree connectivity', () => {
    // The awaited agent sits under an idle middle manager that is itself
    // neither live nor awaited — the below-check must keep the ancestor so
    // the tree stays connected.
    const state = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'in_progress',
          agentSummary: {
            count: 3,
            agentIds: ['coord', 'mid', 'leaf'],
            agents: [
              { id: 'coord', name: 'Coordinator', status: 'idle' },
              { id: 'mid', name: 'Sub-coordinator', status: 'idle', parentAgentId: 'coord' },
              { id: 'leaf', name: 'Implementor', status: 'idle', parentAgentId: 'mid' },
            ],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      {
        agentSessions: {
          byAgentId: {
            coord: {
              status: 'idle',
              isWaitingForOtherAgents: true,
              waitingForAgentIds: ['leaf'],
              messages: [],
            },
          },
          agentIdsByWorkspace: {},
        },
      },
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => [a.id, a.depth])).toEqual([
      ['coord', 0],
      ['mid', 1],
      ['leaf', 2],
    ]);
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
      // grandchild is child-b's LAST (only) child — closing connector, even
      // though it is not the last row overall.
      ['grandchild', 2, '│ └─'],
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

  it("an 'unread' attention value renders the blue UNREAD state, never wait", () => {
    // The daemon raises `unread` on every agent turn end (§9.9) and only
    // `workspace.markSeen` clears it — an otherwise-idle workspace renders
    // the non-urgent UNREAD state, not NEEDS ATTENTION.
    const state = cardState([makeWorkspace('ws-1', { displayStatus: 'idle' })], [['ws-1', 'unread']]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('unread');
    expect(card.attention).toBe('unread');
  });

  it("'unread' never masks urgent/active states", () => {
    // failed / blocked / wait / in_progress / pr_open / pr_ready all outrank
    // the blue-dot flag; only idle / not_started (and absent) plus the
    // terminal complete / pr_merged fall to UNREAD.
    for (const displayStatus of ['in_progress', 'pr_open', 'pr_ready', 'needs_attention'] as const) {
      const state = cardState(
        [makeWorkspace('ws-1', { displayStatus })],
        [['ws-1', 'unread']],
      );
      expect(selectHudWorkspaceCards.select(state)[0].stateKey).toBe(
        displayStatus === 'needs_attention' ? 'wait' : displayStatus,
      );
    }
    const notStarted = cardState([makeWorkspace('ws-1')], [['ws-1', 'unread']]);
    expect(selectHudWorkspaceCards.select(notStarted)[0].stateKey).toBe('unread');
    // A failed live agent outranks the flag too.
    const failed = cardState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'idle',
          agentSummary: {
            count: 1,
            agentIds: ['a1'],
            agents: [{ id: 'a1', name: 'Coordinator', status: 'error' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [['ws-1', 'unread']],
    );
    expect(selectHudWorkspaceCards.select(failed)[0].stateKey).toBe('failed');
  });

  it("an unread 'complete' / 'pr_merged' card renders UNREAD; without the flag they render verbatim", () => {
    // The terminal states carry no pending action — the unseen-result signal
    // wins; marking seen (no flag) falls back to COMPLETE / PR MERGED.
    for (const displayStatus of ['complete', 'pr_merged'] as const) {
      const unread = cardState(
        [makeWorkspace('ws-1', { displayStatus })],
        [['ws-1', 'unread']],
      );
      expect(selectHudWorkspaceCards.select(unread)[0].stateKey).toBe('unread');
      const seen = cardState([makeWorkspace('ws-1', { displayStatus })]);
      expect(selectHudWorkspaceCards.select(seen)[0].stateKey).toBe(displayStatus);
    }
  });

  it("the entity's daemon-served attention renders UNREAD with no live event (app start)", () => {
    // `workspace.list`/`workspace.get` serve `attention` on the entity
    // (§5.1); a workspace already unread at launch must render UNREAD
    // without waiting for a live `workspace:attention-changed` event.
    for (const displayStatus of ['idle', 'complete'] as const) {
      const state = cardState([makeWorkspace('ws-1', { displayStatus, attention: 'unread' })]);
      const [card] = selectHudWorkspaceCards.select(state);
      expect(card.stateKey).toBe('unread');
      expect(card.attention).toBe('unread');
    }
  });

  it('a live clear never falls back to a stale entity attention (bridge keeps both fresh)', () => {
    // markSeen: the live 'none' event deletes the flag map entry and the
    // events bridge writes `attention: "none"` onto the entity (§9.9) — the
    // card must not resurrect UNREAD from the entity fallback.
    const state = cardState(
      [makeWorkspace('ws-1', { displayStatus: 'idle', attention: 'none' })],
      [
        ['ws-1', 'unread'],
        ['ws-1', 'none', '2026-07-30T12:05:00Z'],
      ],
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('idle');
    expect(card.attention).toBeNull();
  });

  it("marking seen (attention 'none') recomputes the UNREAD card back to idle", () => {
    // `workspace.markSeen` clears the unread flag and emits
    // `workspace:attention-changed` with "none" (§9.9) — the fold drops the
    // flag and the card falls back to its displayStatus.
    const state = cardState(
      [makeWorkspace('ws-1', { displayStatus: 'idle' })],
      [
        ['ws-1', 'unread'],
        ['ws-1', 'none', '2026-07-30T12:05:00Z'],
      ],
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('idle');
    expect(card.attention).toBeNull();
  });

  /** Workspace with one top-level and one delegated agent plus session overlays. */
  function gatedState(
    sessions: Record<string, Record<string, unknown>>,
    questions: HudCapturedQuestion[] = [],
    displayStatus: WorkspaceDisplayStatus = 'in_progress',
  ): StoreState {
    const base = mockState(
      [
        makeWorkspace('ws-1', {
          displayStatus,
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

  it('attention snippet carries the blocker reason on a blocked card', () => {
    const state = gatedState({
      root: {
        status: 'active',
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'Sandbox network is down',
        messages: [],
      },
    });
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('blocked');
    expect(card.attentionSnippet).toEqual({ kind: 'blocker', text: 'Sandbox network is down' });
  });

  it('attention snippet prefers the outstanding question over a pending request', () => {
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      header: 'Auth method',
      question: 'Which authentication method should the endpoint use?',
      ts: RAISED_TS,
    };
    const sessions = {
      root: {
        status: 'waiting',
        attentionRequestKind: 'discussion',
        attentionRequestReason: 'Need direction on scope',
        messages: [],
      },
    };
    // A discussion alone does not flip the card (no attention state → no snippet).
    expect(selectHudWorkspaceCards.select(gatedState(sessions, [question]))[0].attentionSnippet)
      .toBeNull();
    // With the daemon's needs_attention rollup the card waits and the
    // question text wins over the discussion reason.
    const rolled = gatedState(sessions, [question], 'needs_attention');
    const [card] = selectHudWorkspaceCards.select(rolled);
    expect(card.stateKey).toBe('wait');
    expect(card.attentionSnippet).toEqual({
      kind: 'question',
      text: 'Which authentication method should the endpoint use?',
    });
  });

  it('attention snippet ignores child/background reasons and is null without one', () => {
    // Child blocker + workspace-level flag: attention raises via the flag,
    // but no gated agent carries a reason → snippet null (status message
    // remains the strip fallback in the component).
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
      [['ws-1', 'review_required']],
    );
    const state = {
      ...base,
      agentSessions: {
        byAgentId: {
          child: {
            status: 'active',
            attentionRequestKind: 'blocker',
            attentionRequestReason: 'Child-only reason',
            messages: [],
          },
        },
        agentIdsByWorkspace: {},
      },
    } as StoreState;
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('wait');
    expect(card.attentionSnippet).toBeNull();
  });

  it('attention snippet is null outside attention states even with a pending reason', () => {
    const state = gatedState({
      child: {
        status: 'active',
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'irrelevant',
        messages: [],
      },
    });
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('in_progress');
    expect(card.attentionSnippet).toBeNull();
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

  it('a genuine ws.app.question.ask (idle agent + needs_attention rollup) shows the Q snippet, not the status text (live bug)', () => {
    // Real wire shape of a raised coordinator question: the asking turn ENDS
    // (agent:stream:end carries the §7.1 trailingBlocks; agent:idle follows),
    // so the agent sits at lowercase `idle` — never `waiting` — while the
    // daemon's step-0 rollup (intentd#825) pushes displayStatus
    // needs_attention. The card footer strip must render the question text,
    // not keep the workspace status message.
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      messageId: 'msg-7',
      header: 'HUD test',
      question: 'Did the ATTENTION panel show a row for this workspace?',
      ts: RAISED_TS,
    };
    const state = gatedState(
      { root: { status: 'idle', isActive: false, messages: [] } },
      [question],
      'needs_attention',
    );
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('wait');
    expect(card.attentionSnippet).toEqual({
      kind: 'question',
      text: 'Did the ATTENTION panel show a row for this workspace?',
    });
    expect(card.agents.find((agent) => agent.id === 'root')?.bucket).toBe('needs-attention');
    expect(selectHudAttnCount.select(state)).toBe(1);
    // The same question with NO tracked session (summary-only hydration —
    // the HUD window never chat-subscribes) still pends off the summary's
    // idle wire status, the shape the daemon reports after the asking turn.
    const idleSummary = mockState(
      [
        makeWorkspace('ws-1', {
          displayStatus: 'needs_attention',
          agentSummary: {
            count: 1,
            agentIds: ['root'],
            agents: [{ id: 'root', name: 'Coordinator', status: 'idle' }],
          } as Workspace['agentSummary'],
        }),
      ],
      [],
      [],
      [question],
    );
    expect(selectHudWorkspaceCards.select(idleSummary)[0].attentionSnippet).toEqual({
      kind: 'question',
      text: 'Did the ATTENTION panel show a row for this workspace?',
    });
  });

  it('needs_attention with no captured reason falls back to the pending snippet (never the status text)', () => {
    // The HUD slice is live-only: a question asked before the window opened
    // was never captured. The daemon rollup is authoritative — the strip
    // must still swap to a generic awaiting-input line.
    const state = mockState([
      makeWorkspace('ws-1', {
        displayStatus: 'needs_attention',
        statusMessage: 'Working through the task list.',
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('wait');
    expect(card.attentionSnippet).toEqual({ kind: 'pending', text: '' });
  });

  it('failed card snippet carries the failing agent stopReason', () => {
    const state = gatedState({
      root: {
        status: 'error',
        stopReason: 'Provider stream disconnected (upstream 529)',
        messages: [],
      },
    });
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('failed');
    expect(card.attentionSnippet).toEqual({
      kind: 'failed',
      text: 'Provider stream disconnected (upstream 529)',
    });
  });

  it('failed card without a known stopReason falls back to the empty failed snippet (never the status text)', () => {
    // Summary-only hydration: no tracked session carries a stopReason. The
    // strip must still swap to the generic failed line — the workspace
    // status message never masks the failure.
    const state = mockState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        statusMessage: 'Wiring the release-channel fetch',
        agentSummary: {
          count: 1,
          agentIds: ['a1'],
          agents: [{ id: 'a1', name: 'Implementor', status: 'error' }],
        } as Workspace['agentSummary'],
      }),
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.stateKey).toBe('failed');
    expect(card.statusMessage).toBe('Wiring the release-channel fetch');
    expect(card.attentionSnippet).toEqual({ kind: 'failed', text: '' });
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

  it('a captured question keeps pending while the agent runs again (persistent contract)', () => {
    // Spec §Decisions: a plain user message — and the turn it starts — no
    // longer supersede the pending Q&A, so a RUNNING agent still owes an
    // answer. Release comes from the slice (`hudQuestionsResolvedForWorkspace`
    // on the daemon's needs_attention rollup drop) or the dismissal marker.
    const question: HudCapturedQuestion = {
      workspaceId: 'ws-1',
      agentId: 'root',
      messageId: 'msg-42',
      header: 'Auth method',
      question: 'Which authentication method should the endpoint use?',
      ts: '2026-07-30T12:00:00Z',
    };
    const running = gatedState({ root: { status: 'active', isResponding: true, messages: [] } }, [
      question,
    ]);
    expect(selectHudWorkspaceCards.select(running)[0].agents[0].hasQuestion).toBe(true);
    expect(selectHudAttnCount.select(running)).toBe(1);

    // Cleared from the slice (answered/dismissed daemon-side): nothing pends.
    const released = gatedState({ root: { status: 'active', isResponding: true, messages: [] } });
    expect(selectHudWorkspaceCards.select(released)[0].agents[0].hasQuestion).toBe(false);
    expect(selectHudAttnCount.select(released)).toBe(0);
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


describe('HUD agent running-state consistency (mid-turn delegated agents)', () => {
  /** ws-1 with one coordinator + one delegated child, summary-level overrides. */
  function midTurnState(
    agents: Array<Record<string, unknown>>,
    sessions: Record<string, Record<string, unknown>> = {},
  ): StoreState {
    const base = mockState([
      makeWorkspace('ws-1', {
        displayStatus: 'in_progress',
        agentSummary: {
          count: agents.length,
          agentIds: agents.map((a) => a.id),
          agents,
        } as Workspace['agentSummary'],
      }),
    ]);
    return {
      ...base,
      agentSessions: {
        byAgentId: Object.fromEntries(
          Object.entries(sessions).map(([id, session]) => [id, { messages: [], ...session }]),
        ),
        agentIdsByWorkspace: {},
      },
    } as StoreState;
  }

  it('a summary-only agent mid-turn (isResponding) buckets running despite a lagging status', () => {
    // The HUD never chat-subscribes per agent, so a delegated child may exist
    // only in agentSummary — the §5.1 turn-liveness flags must mark it running
    // even when the persisted status string still reads idle/waiting.
    const state = midTurnState([
      { id: 'a1', name: 'HUD live-feedback fixes', status: 'idle', isResponding: true },
    ]);
    expect(selectHudAgentStateCounts.select(state).running).toBe(1);
    expect(selectHudAgentStateCounts.select(state).idle).toBe(0);
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.activeAgents.map((a) => a.id)).toEqual(['a1']);
    expect(view?.idleAgents).toEqual([]);
  });

  it('a tracked session mid-turn with a waiting tool call buckets running, not idle', () => {
    // Precedence: an in-flight turn (isResponding) wins over the waiting
    // check — a mid-turn tool call is running work (failed > attention >
    // running > idle).
    const state = midTurnState(
      [{ id: 'a1', name: 'Implementor', status: 'active' }],
      { a1: { status: 'active', isResponding: true, isWaitingOnTool: true } },
    );
    expect(selectHudAgentStateCounts.select(state).running).toBe(1);
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.activeAgents.map((a) => a.bucket)).toEqual(['running']);
  });

  it('post-turn (flags cleared, idle status) buckets idle again', () => {
    const state = midTurnState(
      [{ id: 'a1', name: 'Implementor', status: 'idle', isResponding: false }],
      {
        a1: {
          status: 'idle',
          isResponding: false,
          isStreaming: false,
          isProcessing: false,
        },
      },
    );
    expect(selectHudAgentStateCounts.select(state).running).toBe(0);
    expect(selectHudAgentStateCounts.select(state).idle).toBe(1);
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.activeAgents).toEqual([]);
    expect(view?.idleAgents.map((a) => a.id)).toEqual(['a1']);
  });

  it('header bar and overlay active list always agree (one shared bucket selector)', () => {
    const state = midTurnState([
      { id: 'a1', name: 'Coordinator', status: 'active' },
      { id: 'a2', name: 'Delegate', status: 'idle', isStreaming: true, parentAgentId: 'a1' },
      { id: 'a3', name: 'Bystander', status: 'idle' },
    ]);
    const counts = selectHudAgentStateCounts.select(state);
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(counts.running).toBe(2);
    expect(view?.activeAgents.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(view?.activeAgents.length).toBe(counts.running);
    expect(view?.idleAgents.map((a) => a.id)).toEqual(['a3']);
  });

  it('overlay active list excludes idle ancestors the card rows keep for the tree', () => {
    // The card rows keep an idle parent whose child is live (tree
    // connectivity); the overlay ACTIVE AGENTS list must not count it.
    const state = midTurnState([
      { id: 'a1', name: 'Coordinator', status: 'idle' },
      { id: 'a2', name: 'Delegate', status: 'active', parentAgentId: 'a1' },
    ]);
    const [card] = selectHudWorkspaceCards.select(state);
    expect(card.agents.map((a) => a.id)).toEqual(['a1', 'a2']);
    const view = selectHudTakeoverView.select(state, 'ws-1');
    expect(view?.activeAgents.map((a) => a.id)).toEqual(['a2']);
    expect(view?.idleAgents.map((a) => a.id)).toEqual(['a1']);
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

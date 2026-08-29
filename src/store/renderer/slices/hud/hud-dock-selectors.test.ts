import { describe, expect, it } from 'vitest';
import type { Workspace, WorkspaceId } from '$shared/types';
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
  hudQuestionCaptured,
  hudReducer,
  initialState as hudInitialState,
  type HudCapturedQuestion,
} from './hud-slice';
import { initialState as hardwareConsoleInitialState } from '../hardware-console/hardware-console-slice';
import { selectDockWorkspaces } from './hud-selectors';

const RAISED_TS = '2026-08-29T12:00:00Z';

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

function withAgents(
  id: string,
  agents: Array<Record<string, unknown>>,
  overrides: Partial<Workspace> = {},
): Workspace {
  return makeWorkspace(id, {
    displayStatus: 'needs_attention',
    agentSummary: {
      count: agents.length,
      agentIds: agents.map((agent) => String(agent.id)),
      agents,
    } as Workspace['agentSummary'],
    ...overrides,
  });
}

function mockState(
  workspaces: Workspace[],
  options: {
    attention?: Array<[workspaceId: string, attention: string]>;
    questions?: HudCapturedQuestion[];
    sessions?: Record<string, Record<string, unknown>>;
  } = {},
): StoreState {
  let workspaceState = workspaceInitialState;
  for (const workspace of workspaces) {
    workspaceState = workspaceReducer(workspaceState, setWorkspaceEntity(workspace));
  }
  let hudState = hudReducer(hudInitialState, hudActivated());
  for (const [workspaceId, attention] of options.attention ?? []) {
    hudState = hudReducer(hudState, hudAttentionChanged(workspaceId, attention, RAISED_TS));
  }
  for (const question of options.questions ?? []) {
    hudState = hudReducer(hudState, hudQuestionCaptured(question));
  }
  const workspaceByAgentId = new Map<string, string>();
  for (const workspace of workspaces) {
    for (const agentId of workspace.agentSummary?.agentIds ?? []) {
      workspaceByAgentId.set(String(agentId), String(workspace.id));
    }
  }
  const byAgentId = Object.fromEntries(
    Object.entries(options.sessions ?? {}).map(([id, session]) => [
      id,
      {
        messages: [],
        workspaceId: session.workspaceId ?? workspaceByAgentId.get(id) ?? 'unrelated',
        ...session,
      },
    ]),
  );
  const agentIdsByWorkspace: Record<string, string[]> = {};
  for (const [id, session] of Object.entries(byAgentId)) {
    const workspaceId = String(session.workspaceId);
    agentIdsByWorkspace[workspaceId] = [...(agentIdsByWorkspace[workspaceId] ?? []), id];
  }
  return {
    workspace: workspaceState,
    hud: hudState,
    hardwareConsole: hardwareConsoleInitialState,
    agentSessions: { byAgentId, agentIdsByWorkspace },
  } as StoreState;
}

function question(workspaceId: string, agentId: string): HudCapturedQuestion {
  return {
    workspaceId,
    agentId,
    messageId: `${agentId}-question`,
    header: 'Choice',
    question: 'Which path?',
    ts: RAISED_TS,
  };
}

describe('selectDockWorkspaces', () => {
  it('includes every running, waiting, unread, or action state once', () => {
    const state = mockState(
      [
        makeWorkspace('failure', { displayStatus: 'failed' }),
        makeWorkspace('blocker', { displayStatus: 'blocked' }),
        withAgents('question', [{ id: 'question-agent', name: 'Question', status: 'idle' }]),
        withAgents('discussion', [{ id: 'discussion-agent', name: 'Discussion', status: 'idle' }]),
        makeWorkspace('review'),
        makeWorkspace('unread'),
        makeWorkspace('running', { activity: 'agent_running' }),
        makeWorkspace('waiting', { waiting: true }),
        makeWorkspace('multi', {
          displayStatus: 'failed',
          activity: 'agent_running',
          waiting: true,
        }),
      ],
      {
        attention: [
          ['review', 'review_required'],
          ['unread', 'unread'],
          ['multi', 'unread'],
        ],
        questions: [question('question', 'question-agent')],
        sessions: {
          'question-agent': { status: 'idle' },
          'discussion-agent': { status: 'idle', attentionRequestKind: 'discussion' },
        },
      },
    );

    expect(
      selectDockWorkspaces.select(state).map((item) => ({
        id: item.workspace.id,
        badge: item.badgeKind,
        group: item.priorityGroup,
      })),
    ).toEqual([
      { id: 'failure', badge: 'failure', group: 'action' },
      { id: 'blocker', badge: 'blocker', group: 'action' },
      { id: 'question', badge: 'question', group: 'action' },
      { id: 'discussion', badge: 'none', group: 'action' },
      { id: 'review', badge: 'review', group: 'action' },
      { id: 'multi', badge: 'failure', group: 'action' },
      { id: 'unread', badge: 'none', group: 'unread' },
      { id: 'running', badge: 'none', group: 'active' },
      { id: 'waiting', badge: 'none', group: 'active' },
    ]);
  });

  it('excludes only inactive workspaces with no unread or action signal', () => {
    const state = mockState([
      makeWorkspace('idle', { displayStatus: 'idle' }),
      makeWorkspace('not-started', { displayStatus: 'not_started' }),
      makeWorkspace('complete', { displayStatus: 'complete' }),
      makeWorkspace('pr-open', { displayStatus: 'pr_open' }),
      makeWorkspace('archived-running', {
        status: WorkspaceStatus.Archived,
        activity: 'agent_running',
      }),
      makeWorkspace('deleted-unread', {
        status: WorkspaceStatus.Deleted,
        attention: 'unread',
      }),
    ]);

    expect(selectDockWorkspaces.select(state)).toEqual([]);
  });

  it('uses failure, blocker, question, then review badge precedence', () => {
    const state = mockState(
      [
        withAgents('failure', [{ id: 'failure-question', name: 'Question', status: 'idle' }], {
          displayStatus: 'failed',
        }),
        withAgents('blocker', [{ id: 'blocker-question', name: 'Question', status: 'idle' }], {
          displayStatus: 'blocked',
        }),
        withAgents('question', [{ id: 'question-only', name: 'Question', status: 'idle' }]),
        makeWorkspace('review'),
      ],
      {
        attention: [
          ['failure', 'review_required'],
          ['blocker', 'review_required'],
          ['question', 'review_required'],
          ['review', 'review_required'],
        ],
        questions: [
          question('failure', 'failure-question'),
          question('blocker', 'blocker-question'),
          question('question', 'question-only'),
        ],
        sessions: {
          'failure-question': { status: 'idle' },
          'blocker-question': { status: 'idle' },
          'question-only': { status: 'idle' },
        },
      },
    );

    expect(selectDockWorkspaces.select(state).map((item) => item.badgeKind)).toEqual([
      'failure',
      'blocker',
      'question',
      'review',
    ]);
  });

  it('keeps source order inside priority groups despite activity timestamp changes', () => {
    const workspaces = [
      makeWorkspace('active-a', { activity: 'agent_running' }),
      makeWorkspace('unread-a', { attention: 'unread' }),
      makeWorkspace('action-a', { displayStatus: 'needs_attention' }),
      makeWorkspace('active-b', { waiting: true }),
      makeWorkspace('action-b', { displayStatus: 'failed' }),
      makeWorkspace('unread-b', { attention: 'unread' }),
    ];
    const ids = (state: StoreState) =>
      selectDockWorkspaces.select(state).map((item) => String(item.workspace.id));

    expect(ids(mockState(workspaces))).toEqual([
      'action-a',
      'action-b',
      'unread-a',
      'unread-b',
      'active-a',
      'active-b',
    ]);
    expect(
      ids(
        mockState(
          workspaces.map((workspace, index) => ({
            ...workspace,
            updatedAt: `2026-08-29T12:00:0${5 - index}Z`,
          })),
        ),
      ),
    ).toEqual(['action-a', 'action-b', 'unread-a', 'unread-b', 'active-a', 'active-b']);
  });
});

import { describe, expect, it } from 'vitest';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createMockWorkspace } from '../../test/factories/workspace.factory';
import { getHomeAttentionRequests, getHomeStatusCause } from './home-attention';
import { homeDismissQuestionAction, homeRetryAgentAction } from './home-attention-actions';
import { getHomeTriageGroup, type HomeTriageInput } from './home-model';
import { decideHomeSetAside, homeSetAsideAttention } from './home-set-aside-attention';

// Failure cases: dismissed questions reappear; stale confirmation dismisses a new
// set; unrelated agents/workspaces are targeted; deleted/delegated/muted requests
// leak into top-level triage; old prose fabricates attention; retry starts a live
// turn; workspace review is treated as approval; status cause contradicts triage.
const agent = (changes: Partial<AgentSession> = {}) =>
  ({
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Coordinator',
    status: AgentStatus.Idle,
    metadata: { pendingQuestionsMessageId: 'question-1' },
    ...changes,
  }) as AgentSession;

const asideRecord = (workspace: Workspace, agents: AgentSession[] = []) => ({
  at: 0,
  known: homeSetAsideAttention(workspace, agents).map(({ token }) => token),
  knownAt: 0,
});

describe('Home actionable attention', () => {
  it('keeps live request reason and timestamp without inferring from prose', () => {
    const rows = getHomeAttentionRequests('ws-1', [
      agent({
        metadata: {
          pendingQuestionsMessageId: 'question-1',
          attentionRequestKind: 'discussion',
          attentionRequestReason: 'Choose a target',
          attentionRequestTimestamp: '2026-10-01T12:00:00Z',
        },
      }),
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        questionMessageId: 'question-1',
        kind: 'discussion',
        reason: 'Choose a target',
        timestamp: '2026-10-01T12:00:00Z',
      }),
    ]);
    expect(
      getHomeAttentionRequests('ws-1', [agent({ metadata: {}, digest: 'Blocked: ask me' })]),
    ).toEqual([]);

    const workspace = createMockWorkspace({
      id: WorkspaceId('ws-1'),
      displayStatus: 'needs_attention',
      attention: 'review_required',
      attentionReminder: {
        reasons: [{ id: 'opaque-reminder', revision: 'opaque-first' }],
        dismissed: false,
        displayStatus: 'needs_attention',
      },
    });
    // A private hold or invalidation can omit the projection without changing raw status.
    expect(
      decideHomeSetAside(
        asideRecord(workspace),
        homeSetAsideAttention({ ...workspace, attentionReminder: undefined }, []),
        new Set(),
        1,
      ).kind,
    ).toBe('return');
  });

  it('retires a dismissed question but keeps an independent blocker', () => {
    const dismissed = agent({
      metadata: {
        pendingQuestionsMessageId: 'question-1',
        dismissedQuestionsMessageId: 'question-1',
      },
    });
    expect(getHomeAttentionRequests('ws-1', [dismissed])).toEqual([]);
    expect(
      getHomeAttentionRequests('ws-1', [
        {
          ...dismissed,
          attentionRequestKind: 'blocker',
          attentionRequestReason: 'Missing credentials',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: 'blocker',
        reason: 'Missing credentials',
        questionMessageId: null,
      }),
    ]);
    expect(
      getHomeAttentionRequests('ws-1', [
        agent({
          metadata: {
            pendingQuestionsMessageId: 'question-2',
            dismissedQuestionsMessageId: 'question-1',
          },
        }),
      ])[0].questionMessageId,
    ).toBe('question-2');

    const settled = createMockWorkspace({
      id: WorkspaceId('ws-1'),
      displayStatus: 'idle',
      attention: 'none',
      attentionReminder: { reasons: [], dismissed: false, displayStatus: 'idle' },
    });
    const personallyDismissed: Workspace = {
      ...settled,
      displayStatus: 'needs_attention',
      attention: 'review_required',
      attentionReminder: {
        reasons: [{ id: 'opaque-reminder', revision: 'opaque-first' }],
        dismissed: true,
        displayStatus: 'waiting',
      },
    };
    expect(
      decideHomeSetAside(
        asideRecord(settled),
        homeSetAsideAttention(personallyDismissed, []),
        new Set(),
        1,
      ).kind,
    ).toBe('unchanged');
    for (const displayStatus of ['blocked', 'failed'] as const)
      expect(
        decideHomeSetAside(
          asideRecord(settled),
          homeSetAsideAttention({ ...personallyDismissed, displayStatus }, []),
          new Set(),
          1,
        ).kind,
      ).toBe('return');
    // Session requests have their own baseline: a stale projection must not hide a new question.
    expect(
      decideHomeSetAside(
        asideRecord(personallyDismissed, [agent()]),
        homeSetAsideAttention(personallyDismissed, [
          agent({ metadata: { pendingQuestionsMessageId: 'question-2' } }),
        ]),
        new Set(['agent-1']),
        1,
      ).kind,
    ).toBe('return');
  });

  it.each([
    { workspaceId: 'other' },
    { retiredAt: '2026-10-01' },
    { pendingDeleteAt: '2026-10-01' },
    { status: AgentStatus.Deleted },
    { parentAgentId: 'parent' },
    { isBackground: true },
    { notificationsMuted: true },
  ])('excludes requests outside Home attention scope: %o', (changes) => {
    expect(getHomeAttentionRequests('ws-1', [agent(changes)])).toEqual([]);
  });

  it('rechecks the exact current question before constructing the dismissal action', () => {
    const action = homeDismissQuestionAction('ws-1', agent(), 'question-1');
    expect(action?.type).toBe('agentSessions/dismissQuestionsRequested');
    expect(action?.payload).toEqual(['agent-1', 'ws-1', 'question-1']);
    expect(homeDismissQuestionAction('ws-1', agent(), 'question-old')).toBeNull();
    expect(homeDismissQuestionAction('other', agent(), 'question-1')).toBeNull();
    expect(
      homeDismissQuestionAction(
        'ws-1',
        agent({
          metadata: {
            pendingQuestionsMessageId: 'question-1',
            dismissedQuestionsMessageId: 'question-1',
          },
        }),
        'question-1',
      ),
    ).toBeNull();
  });

  it('retries only the requested failed agent, never a running turn or discussion', () => {
    const failed = agent({ status: AgentStatus.Error, metadata: {}, stopReason: 'provider_error' });
    expect(homeRetryAgentAction('ws-1', failed)?.payload).toEqual(['agent-1', 'ws-1']);
    expect(homeRetryAgentAction('ws-1', agent())).toBeNull();
    expect(homeRetryAgentAction('ws-1', { ...failed, isResponding: true })).toBeNull();
    expect(homeRetryAgentAction('other', failed)).toBeNull();
  });

  it('explains structured causes with the same precedence as Home grouping', () => {
    expect(getHomeStatusCause({ displayStatus: 'failed', attention: 'review_required' })).toBe(
      'failed',
    );
    expect(getHomeStatusCause({ displayStatus: 'blocked', activity: 'agent_running' })).toBe(
      'blocked',
    );
    expect(getHomeStatusCause({ displayStatus: 'complete', attention: 'review_required' })).toBe(
      'review',
    );
    expect(getHomeStatusCause({ displayStatus: 'needs_attention' })).toBe('question');
    expect(getHomeStatusCause({ displayStatus: 'pr_ready' })).toBe('pr_ready');
    expect(getHomeStatusCause({ displayStatus: 'idle', activity: 'agent_running' })).toBe(
      'running',
    );
    expect(getHomeStatusCause({ displayStatus: 'idle', attention: 'unread' })).toBe('unread');
    expect(getHomeStatusCause({ displayStatus: 'idle', scriptsRunning: true })).toBe(
      'scripts_running',
    );
    expect(
      getHomeStatusCause({
        displayStatus: 'idle',
        activity: 'agent_running',
        scriptsRunning: true,
      }),
    ).toBe('running');

    expect(getHomeStatusCause({ displayStatus: 'pr_ready', scriptsRunning: true })).toBe(
      'pr_ready',
    );
    expect(getHomeStatusCause({ displayStatus: 'complete', backgroundTasksRunning: true })).toBe(
      'background_tasks_running',
    );
    expect(
      getHomeStatusCause({
        displayStatus: 'idle',
        scriptsRunning: true,
        backgroundTasksRunning: true,
      }),
    ).toBe('scripts_running');
    expect(
      getHomeStatusCause({
        displayStatus: 'idle',
        activity: 'agent_running',
        backgroundTasksRunning: true,
      }),
    ).toBe('running');
    const first = createMockWorkspace({
      displayStatus: 'needs_attention',
      attention: 'review_required',
      attentionReminder: {
        reasons: [{ id: 'opaque-reminder', revision: 'opaque-first' }],
        dismissed: false,
        displayStatus: 'needs_attention',
      },
    });
    const record = asideRecord(first);
    expect(decideHomeSetAside(record, homeSetAsideAttention(first, []), new Set(), 1).kind).toBe(
      'unchanged',
    );
    expect(
      decideHomeSetAside(
        record,
        homeSetAsideAttention(
          {
            ...first,
            attentionReminder: {
              ...first.attentionReminder!,
              reasons: [{ id: 'opaque-reminder', revision: 'opaque-second' }],
            },
          },
          [],
        ),
        new Set(),
        1,
      ).kind,
    ).toBe('return');
  });
});

describe('Home PR status precedence', () => {
  it.each(['pr_open', 'pr_ready', 'pr_queued'] as const)(
    'keeps %s distinct and groups it by PR stage',
    (displayStatus) => {
      expect(getHomeStatusCause({ displayStatus })).toBe(displayStatus);
      expect(getHomeTriageGroup({ displayStatus })).toBe(
        { pr_open: 'idle', pr_ready: 'pr-ready', pr_queued: 'waiting' }[displayStatus],
      );
      expect(getHomeStatusCause({ displayStatus, attention: 'review_required' })).toBe('review');
      expect(getHomeStatusCause({ displayStatus, activity: 'agent_running' })).toBe(
        displayStatus === 'pr_ready' ? 'pr_ready' : 'running',
      );
      expect(getHomeStatusCause({ displayStatus, attention: 'unread' })).toBe(
        displayStatus === 'pr_ready' ? 'pr_ready' : 'unread',
      );
    },
  );

  it.each([
    ['failed', 'failed'],
    ['blocked', 'blocked'],
    ['needs_attention', 'question'],
    ['pr_merged', 'merged'],
    ['complete', 'complete'],
    ['future_status', 'idle'],
  ])('preserves the %s cause and safe fallback', (displayStatus, cause) => {
    expect(getHomeStatusCause({ displayStatus } as HomeTriageInput)).toBe(cause);
  });
});

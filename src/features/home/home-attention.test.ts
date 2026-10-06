import { describe, expect, it } from 'vitest';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import { getHomeAttentionRequests, getHomeStatusCause } from './home-attention';
import { homeDismissQuestionAction, homeRetryAgentAction } from './home-attention-actions';

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
    expect(getHomeStatusCause({ displayStatus: 'pr_ready' })).toBe('pull-request');
    expect(getHomeStatusCause({ displayStatus: 'idle', activity: 'agent_running' })).toBe(
      'running',
    );
    expect(getHomeStatusCause({ displayStatus: 'idle', attention: 'unread' })).toBe('unread');
  });
});

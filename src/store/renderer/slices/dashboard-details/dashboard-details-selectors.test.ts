import { afterEach, describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceStatus, type AgentSession, type Workspace } from '$shared/types';
import type { StoreState } from '../../types';
import {
  selectDashboardWorkspaceAgentIds,
  selectDashboardWorkspaceDetails,
  selectDashboardWorkspaceQuestionRecoveries,
} from '../hud/hud-selectors';
import { initialState as hudInitialState } from '../hud/hud-slice';
import { initialState as workspaceInitialState } from '../workspace/workspace-slice';
import {
  initialState as usageInitialState,
  tokenUsageFetchFailed,
  tokenUsageReceived,
  tokenUsageReducer,
} from '../token-usage/token-usage-slice';
import {
  clearPendingAgentDeletions,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import {
  chatStateReducer,
  initialState as chatInitialState,
  pendingQuestionRecoveryRequested,
  pendingQuestionRecoverySettled,
} from '../chat-state/chat-state-slice';

const WS = 'dashboard-workspace';

function stateWithAgents(
  rows: Array<Record<string, unknown>> = [],
  sessions: Record<string, Partial<AgentSession>> = {},
  displayStatus: Workspace['displayStatus'] = 'in_progress',
): StoreState {
  const workspace = {
    id: WS,
    title: 'Dashboard',
    status: WorkspaceStatus.Active,
    displayStatus,
    agentSummary: { count: rows.length, agentIds: rows.map((row) => row.id), agents: rows },
  } as Workspace;
  return {
    workspace: { ...workspaceInitialState, workspaces: createCollection('id', [workspace]) },
    hud: hudInitialState,
    tokenUsage: usageInitialState,
    agentSessions: {
      byAgentId: Object.fromEntries(
        Object.entries(sessions).map(([id, session]) => [
          id,
          { id, workspaceId: WS, messages: [], ...session },
        ]),
      ),
      agentIdsByWorkspace: {},
    },
  } as StoreState;
}

afterEach(clearPendingAgentDeletions);

describe('dashboard workspace details', () => {
  it('keeps unknown or stale usage distinct from a loaded zero and includes thought tokens', () => {
    let state = stateWithAgents();
    expect(selectDashboardWorkspaceDetails.select(state, WS).tokens).toBeNull();
    const usage = {
      byAgentId: {},
      byModel: {},
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      lastScanAt: null,
    };
    state = {
      ...state,
      tokenUsage: tokenUsageReducer(state.tokenUsage, tokenUsageReceived(WS, usage)),
    };
    expect(selectDashboardWorkspaceDetails.select(state, WS).tokens).toBe(0);
    state = {
      ...state,
      tokenUsage: tokenUsageReducer(
        state.tokenUsage,
        tokenUsageReceived(WS, {
          ...usage,
          totals: {
            inputTokens: 11,
            outputTokens: 7,
            cacheReadTokens: 3,
            cacheCreationTokens: 5,
            thoughtTokens: 13,
          },
        }),
      ),
    };
    expect(selectDashboardWorkspaceDetails.select(state, WS).tokens).toBe(39);
    state = {
      ...state,
      tokenUsage: tokenUsageReducer(state.tokenUsage, tokenUsageFetchFailed(WS)),
    };
    expect(selectDashboardWorkspaceDetails.select(state, WS).tokens).toBeNull();
  });

  it('keeps an idle parent above its working child and uses canonical preview and activity', () => {
    const state = stateWithAgents(
      [
        { id: 'child', name: 'Implementor', status: 'active', parentAgentId: 'parent' },
        { id: 'parent', name: 'Coordinator', status: 'idle', specialist: 'spec-writer' },
      ],
      {
        child: {
          status: 'active' as AgentSession['status'],
          digest: 'Updating the dashboard',
          lastActivity: '2026-10-08T20:00:00Z',
        },
      },
    );
    expect(selectDashboardWorkspaceDetails.select(state, WS).agents).toMatchObject([
      { id: 'parent', depth: 0, bucket: 'idle' },
      {
        id: 'child',
        depth: 1,
        parentAgentId: 'parent',
        bucket: 'running',
        line: 'Updating the dashboard',
        lastActivityTs: '2026-10-08T20:00:00Z',
      },
    ]);
  });

  it('reads pending reasons from AgentLite metadata and excludes muted and delegated reasons', () => {
    const rows = [
      { id: 'muted', name: 'Muted', status: 'waiting' },
      { id: 'child', name: 'Child', status: 'waiting', parentAgentId: 'root' },
      { id: 'root', name: 'Root', status: 'waiting' },
    ];
    const state = stateWithAgents(
      rows,
      {
        muted: {
          notificationsMuted: true,
          metadata: { attentionRequestKind: 'blocker', attentionRequestReason: 'Muted reason' },
        },
        child: {
          metadata: { attentionRequestKind: 'blocker', attentionRequestReason: 'Child reason' },
        },
        root: {
          metadata: {
            attentionRequestKind: 'discussion',
            attentionRequestReason: 'Choose a target',
          },
        },
      },
      'needs_attention',
    );
    expect(selectDashboardWorkspaceDetails.select(state, WS).attentionSnippet).toEqual({
      kind: 'discussion',
      text: 'Choose a target',
    });
    const noReason = stateWithAgents(rows, {}, 'needs_attention');
    expect(selectDashboardWorkspaceDetails.select(noReason, WS).attentionSnippet).toEqual({
      kind: 'pending',
      text: '',
    });
    expect(selectDashboardWorkspaceAgentIds.select(noReason, WS)).toContain('root');
  });

  it('drops deleted, soft-hidden, retired, and wrong-workspace sessions before deriving rows', () => {
    const ids = ['live', 'deleted', 'pending', 'retired', 'local-delete', 'other-workspace'];
    const state = stateWithAgents(
      ids.map((id) => ({ id, name: id, status: 'active' })),
      {
        deleted: { status: 'deleted' as AgentSession['status'] },
        pending: { pendingDeleteAt: '2026-10-08T20:00:00Z' },
        retired: { retiredAt: '2026-10-08T20:00:00Z' },
        'other-workspace': { workspaceId: 'elsewhere' as AgentSession['workspaceId'] },
      },
    );
    setPendingAgentDeletion({ agentId: 'local-delete', wsId: WS });
    expect(
      selectDashboardWorkspaceDetails.select(state, WS).agents.map((agent) => agent.id),
    ).toEqual(['live']);
    expect(selectDashboardWorkspaceAgentIds.select(state, WS)).toEqual(['live']);
  });

  it('does not use HUD-only display overrides after that separate view is closed', () => {
    const state = stateWithAgents([], {}, 'complete');
    state.hud = { ...state.hud, displayStatusByWorkspaceId: { [WS]: 'needs_attention' } };
    expect(selectDashboardWorkspaceDetails.select(state, WS).attentionSnippet).toBeNull();
    expect(selectDashboardWorkspaceDetails.select(state, 'missing')).toEqual({
      agents: [],
      attentionSnippet: null,
      tokens: null,
    });
  });

  it('recovers marked question text through the chat owner and honors explicit clear and dismissal', () => {
    const rows = [{ id: 'root', name: 'Root', status: 'idle' }];
    const metadata = { pendingQuestionsMessageId: 'question-message' };
    let state = stateWithAgents(rows, { root: { metadata } }, 'needs_attention');
    expect(selectDashboardWorkspaceQuestionRecoveries.select(state, WS)).toEqual([
      { agentId: 'root', messageId: 'question-message' },
    ]);
    expect(selectDashboardWorkspaceDetails.select(state, WS).agents).toMatchObject([
      { id: 'root', bucket: 'needs-attention', hasQuestion: true },
    ]);
    state = {
      ...state,
      chatState: chatStateReducer(
        chatStateReducer(
          chatInitialState,
          pendingQuestionRecoveryRequested('root', 'question-message'),
        ),
        pendingQuestionRecoverySettled('root', 'question-message', 'found', [
          {
            attachmentId: 'tar-question',
            header: 'Target',
            question: 'Which target?',
            options: [{ label: 'Local' }, { label: 'Remote' }],
          },
        ]),
      ),
    };
    expect(selectDashboardWorkspaceDetails.select(state, WS).attentionSnippet).toEqual({
      kind: 'question',
      text: 'Which target?',
    });
    expect(selectDashboardWorkspaceQuestionRecoveries.select(state, WS)).toEqual([]);
    for (const resolvedMetadata of [
      { pendingQuestionsMessageId: '' },
      { ...metadata, dismissedQuestionsMessageId: 'question-message' },
    ]) {
      const resolved = {
        ...stateWithAgents(rows, { root: { metadata: resolvedMetadata } }, 'needs_attention'),
        chatState: state.chatState,
      };
      expect(selectDashboardWorkspaceDetails.select(resolved, WS).attentionSnippet).toEqual({
        kind: 'pending',
        text: '',
      });
      expect(selectDashboardWorkspaceDetails.select(resolved, WS).agents).toEqual([]);
      expect(selectDashboardWorkspaceQuestionRecoveries.select(resolved, WS)).toEqual([]);
    }
  });
});

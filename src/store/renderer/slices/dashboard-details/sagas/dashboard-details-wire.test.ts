import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
} from '../../../../../test/mocks/backend-transport.mock';
import { store as appStore } from '../../../store';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import { selectDashboardWorkspaceDetails } from '../../hud/hud-selectors';
import { agentReadSaga } from '../../workspace-agents/sagas/agent-read-saga';
import { chatScrollbackSaga } from '../../chat-state/sagas/chat-scrollback-saga';
import { lifecycleReadSaga } from '../../workspace-lifecycle/sagas/lifecycle-read-saga';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { setDashboardVisibleWorkspaces } from '../dashboard-details-slice';
import { dashboardDetailsSaga } from './dashboard-details-saga';

const WS = '22222222-2222-4222-8222-222222222222';
const AGENT = 'agent-33333333-3333-4333-8333-333333333333';
const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  resetMockBackend();
});

describe('dashboard detail reads against the daemon contract', () => {
  it.each(['blocker', 'question'] as const)(
    'loads %s details through existing readers without starting subscriptions',
    async (kind) => {
      const backend = installMockBackend();
      let revision = 1;
      backend.onRequest('agent.get', () => ({
        agent: {
          id: AGENT,
          workspaceId: WS,
          name: 'Coordinator',
          status: 'idle',
          messageCount: 2,
          createdAt: '2026-10-08T20:00:00Z',
          updatedAt: '2026-10-08T20:01:00Z',
          lastActivity: '2026-10-08T20:01:00Z',
          metadata:
            kind === 'question'
              ? { pendingQuestionsMessageId: `question-message-${revision}` }
              : {
                  attentionRequestKind: 'blocker',
                  attentionRequestReason:
                    revision === 1 ? 'The build host is offline' : 'The release host is offline',
                  attentionRequestTimestamp: '2026-10-08T20:01:00Z',
                },
        },
      }));
      backend.onRequest('agent.getConversation', () => ({
        messages: [
          {
            id: `question-message-${revision}`,
            role: 'assistant',
            timestamp: '2026-10-08T20:01:00Z',
            contentBlocks: [
              {
                type: 'resource',
                resource: {
                  uri: 'intent-question://tar-dashboard',
                  mimeType: 'application/vnd.intent.question+json',
                  text: JSON.stringify({
                    attachmentId: 'tar-dashboard',
                    header: 'Build host',
                    question:
                      revision === 1
                        ? 'Which build host should I use?'
                        : 'Which release host should I use?',
                    options: [{ label: 'Local' }, { label: 'Remote' }],
                  }),
                },
              },
            ],
          },
        ],
        truncated: false,
        totalMessages: 2,
        nextToken: null,
        prevToken: null,
      }));
      backend.onRequest('workspace.getTokenUsage', () => ({
        tokenUsage: {
          byAgentId: {},
          byModel: {},
          totals: {
            inputTokens: 10 * revision,
            outputTokens: 4,
            cacheReadTokens: 2,
            cacheCreationTokens: 3,
            thoughtTokens: 1,
          },
          lastScanAt: '2026-10-08T20:01:00Z',
        },
      }));
      cleanup.push(appStore.init());
      appStore.dispatch(
        setWorkspaceEntity({
          id: WS,
          title: 'Live dashboard',
          status: WorkspaceStatus.Active,
          displayStatus: 'blocked',
          agentSummary: {
            count: 1,
            agentIds: [AGENT],
            agents: [{ id: AGENT, name: 'Coordinator', status: 'idle' }],
          },
        } as Workspace),
      );
      cleanup.push(appStore.runSaga(agentReadSaga));
      cleanup.push(appStore.runSaga(chatScrollbackSaga));
      cleanup.push(appStore.runSaga(lifecycleReadSaga));
      cleanup.push(appStore.runSaga(dashboardDetailsSaga));
      appStore.dispatch(setDashboardVisibleWorkspaces('cards', [WS]));
      appStore.dispatch(setDashboardVisibleWorkspaces('mirror', [WS]));
      appStore.dispatch(setDashboardVisibleWorkspaces('cards', []));
      await vi.waitFor(() => {
        expect(selectDashboardWorkspaceDetails.select(appStore.state, WS)).toMatchObject({
          agents: [{ id: AGENT, bucket: 'needs-attention' }],
          attentionSnippet: {
            kind,
            text:
              kind === 'question' ? 'Which build host should I use?' : 'The build host is offline',
          },
          tokens: 20,
        });
      });
      expect(backend.requests).toEqual(
        expect.arrayContaining([
          { method: 'agent.get', params: { agentId: AGENT, workspaceId: WS } },
          { method: 'workspace.getTokenUsage', params: { workspaceId: WS } },
        ]),
      );
      expect(backend.requests.filter((request) => request.method === 'agent.get')).toHaveLength(1);
      expect(
        backend.requests.filter((request) => request.method === 'workspace.getTokenUsage'),
      ).toHaveLength(1);
      expect(
        backend.requests.filter((request) => request.method === 'agent.getConversation'),
      ).toEqual(
        kind === 'question'
          ? [
              {
                method: 'agent.getConversation',
                params: {
                  agentId: AGENT,
                  workspaceId: WS,
                  limit: 1,
                  projection: 'slim',
                  aroundMessageId: 'question-message-1',
                },
              },
            ]
          : [],
      );
      expect(backend.subscribes).toEqual([]);
      expect(backend.requests.some((request) => request.method === 'agent.list')).toBe(false);

      // Existing cached sessions must not bypass the fresh read after recovery.
      revision = 2;
      backend.triggerReconnect();
      appStore.dispatch(daemonEventsSubscribed());
      await vi.waitFor(() => {
        expect(selectDashboardWorkspaceDetails.select(appStore.state, WS)).toMatchObject({
          attentionSnippet: {
            kind,
            text:
              kind === 'question'
                ? 'Which release host should I use?'
                : 'The release host is offline',
          },
          tokens: 30,
        });
      });
      expect(backend.requests.filter((request) => request.method === 'agent.get')).toEqual([
        { method: 'agent.get', params: { agentId: AGENT, workspaceId: WS } },
        { method: 'agent.get', params: { agentId: AGENT, workspaceId: WS } },
      ]);
      expect(
        backend.requests.filter((request) => request.method === 'workspace.getTokenUsage'),
      ).toHaveLength(2);
      expect(backend.subscribes).toEqual([]);
    },
  );
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession, type QueuedMessage, type Workspace } from '$shared/types';
import { createAdmittedLegacyPrincipal } from '../../../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
import { transcriptHydrationSettled } from '$store/renderer/slices/chat-state/chat-state-slice';
import { chatPanelUiSaga } from '$store/renderer/slices/chat-panel-ui/sagas/chat-panel-ui-saga';
import { LiveAgentsClient } from '$lib/client/live/live-agents-client';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import ChatPanel from '../ChatPanel.svelte';

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspaceDetail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/FaIcon.svelte')).default }));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('./mocks/Button.svelte')).default,
}));
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../MonitoredScriptsRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AuroraBackground.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

const workspace = { id: 'quarantine-ws', title: 'Recovery', myRole: 'owner' } as Workspace;
const agentId = 'quarantine-agent';
const queue: QueuedMessage[] = [
  {
    id: 'original-queue-id',
    turnId: 'original-turn-id',
    submissionIds: ['original-submission-id'],
    content: 'Continue the review',
    position: 0,
    queuedAt: '2026-10-07T07:00:00Z',
    requeuedAfterFailure: true,
    imageBlocks: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
  },
];
let dispose: () => void;
let stopSaga: () => void;
let backend: MockBackendHandle;

beforeEach(() => {
  backend = installMockBackend();
  backend.onRequest('agent.getQueue', () => ({ success: true, queue }));
  dispose = store.init(createAdmittedLegacyPrincipal());
  stopSaga = store.runSaga(function* () {
    yield* chatPanelUiSaga(new LiveAgentsClient());
  });
  store.dispatch(setWorkspaceEntity(workspace));
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: workspace.id,
        name: 'Recovery agent',
        status: AgentStatus.Error,
        sessionCorrupted: true,
        stopReason: 'Failed to load workspace requirements',
        messages: [
          {
            id: 'original-user',
            role: 'user',
            content: 'Continue the review',
            timestamp: '2026-10-07T07:00:00Z',
          },
        ],
      } as AgentSession,
    ]),
  );
  store.dispatch(replaceAgentQueue(agentId, queue, workspace.id));
  store.dispatch(transcriptHydrationSettled(agentId));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  stopSaga();
  vi.restoreAllMocks();
  dispose();
  resetMockBackend();
  vi.unstubAllGlobals();
});
const retryRequests = () => backend.requests.filter((request) => request.method === 'agent.retry');
const mount = () => render(ChatPanel, { props: { workspace, agentId, isActive: true } });

describe('terminal session recovery with a failure-restored user queue', () => {
  it.each([true, false])(
    'uses agent.retry once and preserves queue identity (corrupted=%s)',
    async (sessionCorrupted) => {
      store.dispatch(updateSession(agentId, { sessionCorrupted }));
      let complete!: (result: unknown) => void;
      backend.onRequest(
        'agent.retry',
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      mount();
      expect(screen.getByTestId('queued-message-retry-status').textContent?.trim()).toBe('Queued');
      const dispatch = vi.spyOn(store, 'dispatch');
      const retry = await screen.findByRole('button', { name: 'Retry', exact: true });
      await fireEvent.click(retry);
      await fireEvent.click(retry);
      await waitFor(() =>
        expect(retryRequests()).toEqual([
          {
            method: 'agent.retry',
            params: { agentId, workspaceId: workspace.id },
          },
        ]),
      );
      expect(selectAgentQueueMessages.select(store.state, agentId, workspace.id)).toEqual(queue);
      expect(
        backend.requests.some((request) =>
          ['agent.sendMessage', 'agent.sendQueuedMessageNow', 'agent.enqueueMessage'].includes(
            request.method,
          ),
        ),
      ).toBe(false);
      complete({ ok: true, redriven: true, turnId: 'original-turn-id' });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Retry', exact: true })).toBeNull(),
      );
      expect(selectAgentSession.select(store.state, agentId)?.status).toBe(AgentStatus.Pending);
      expect(
        dispatch.mock.calls.filter(([action]) => action.type === 'chatPanelUi/retryAgentRequested'),
      ).toHaveLength(1);
      expect(
        dispatch.mock.calls.some(
          ([action]) => action.type === 'agentSessions/retryLastMessageRequested',
        ),
      ).toBe(false);
      expect(retryRequests()).toHaveLength(1);
      expect(selectAgentQueueMessages.select(store.state, agentId, workspace.id)).toEqual(queue);
    },
  );

  it('withholds Retry for retired read-only sessions', () => {
    store.dispatch(updateSession(agentId, { retiredAt: '2026-10-07T07:01:00Z' }));
    mount();
    expect(screen.getByTestId('failure-recovery-card')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry', exact: true })).toBeNull();
    expect(retryRequests()).toHaveLength(0);
  });

  it('withholds Retry while a new turn is active despite the stale failure and queue', () => {
    store.dispatch(updateSession(agentId, { status: AgentStatus.Active, isProcessing: true }));
    mount();
    expect(screen.queryByRole('button', { name: 'Retry', exact: true })).toBeNull();
    expect(retryRequests()).toHaveLength(0);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import {
  retireAgentRequested,
  restoreRetiredAgentRequested,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '@/test/mocks/backend-transport.mock';

vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('@/test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

const workspaceId = WorkspaceId('indexed-retirement');
let backend: MockBackendHandle;
let agentId: ReturnType<typeof AgentId>;
let sequence = 0;
let stopMutations: () => void;

beforeAll(() => {
  backend = installMockBackend();
  store.init();
});
beforeEach(() => {
  agentId = AgentId(`indexed-retirement-${++sequence}`);
  stopMutations = store.runSaga(agentMutationSaga);
});
afterEach(() => {
  stopMutations();
  store.dispatch(removeSession(agentId));
});
afterAll(() => resetMockBackend());

it.each(['retire', 'restore'] as const)(
  'fences a stale %s reply and applies a fresh result to the indexed session',
  async (operation) => {
    const original: AgentSession = {
      id: agentId,
      workspaceId,
      backendSessionId: null,
      name: 'Original connection',
      status: AgentStatus.Active,
      messages: [],
      createdAt: '2026-09-28T08:00:00Z',
      updatedAt: '2026-09-28T08:00:00Z',
      retiredAt: operation === 'restore' ? '2026-09-28T09:00:00Z' : undefined,
    };
    store.dispatch(bulkUpsertSessions([original]));
    expect(store.state.agentSessions.agentIdsByWorkspace[workspaceId]).toContain(agentId);
    const action = () =>
      operation === 'retire'
        ? retireAgentRequested(workspaceId, agentId)
        : restoreRetiredAgentRequested(workspaceId, agentId);
    backend.onRequest('client.hello', () => ({ server: { capabilities: { agentRetire: 1 } } }));
    let finish: ((value: unknown) => void) | undefined;
    backend.onRequest(`agent.${operation}`, () => new Promise((resolve) => (finish = resolve)));
    const pending = store.dispatch(action());
    await waitFor(() => expect(finish).toBeTypeOf('function'));

    backend.triggerReconnect();
    store.dispatch(bulkUpsertSessions([{ ...original, name: 'New connection' }]));
    const replacement = store.state.agentSessions.byAgentId[agentId];
    finish!({ success: true, retiredAt: '2026-09-28T10:00:00Z' });
    await pending;
    expect(store.state.agentSessions.byAgentId[agentId]).toBe(replacement);

    const requestsBefore = backend.requests.length;
    backend.onRequest(`agent.${operation}`, () => ({
      success: true,
      retiredAt: '2026-09-28T11:00:00Z',
    }));
    await store.dispatch(action());
    expect(backend.requests.slice(requestsBefore)).toContainEqual({
      method: `agent.${operation}`,
      params: { agentId, workspaceId },
    });
    const current = store.state.agentSessions.byAgentId[agentId];
    expect(current.retiredAt).toBe(operation === 'retire' ? '2026-09-28T11:00:00Z' : undefined);
    expect(current.name).toBe('New connection');
    expect(store.state.agentSessions.agentIdsByWorkspace[workspaceId]).toContain(agentId);
  },
);

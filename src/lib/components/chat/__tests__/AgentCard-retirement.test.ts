/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import AgentCard from '../AgentCard.svelte';
import { store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

const workspace = { id: WorkspaceId('ws-retire'), myRole: 'owner' } as Workspace;
const agentId = AgentId('agent-retire-card');
const retiredAt = '2026-09-28T08:00:00Z';
let backend: MockBackendHandle;
let stop: () => void;
function seed(overrides: Partial<AgentSession> = {}) {
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: workspace.id,
        name: 'Retirement fixture',
        status: AgentStatus.Active,
        messages: [],
        createdAt: retiredAt,
        updatedAt: retiredAt,
        harnessFeatures: { peerAgents: false },
        ...overrides,
      } as AgentSession,
    ]),
  );
}
async function openMenu() {
  await fireEvent.contextMenu(
    (await screen.findByTestId('agent-list-item')).querySelector('button')!,
  );
}
async function openConfirmation() {
  await openMenu();
  await fireEvent.click(await screen.findByText('Retire Agent'));
  await screen.findByRole('dialog');
}

beforeEach(() => {
  store.init();
  backend = installMockBackend();
  store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  store.dispatch(replaceWorkspaceList([workspace]));
  store.dispatch(setWorkspaceHasLoaded(true));
  seed();
  stop = store.runSaga(agentMutationSaga);
});
afterEach(() => {
  cleanup();
  stop();
  store.dispatch(removeSession(agentId));
  resetMockBackend();
});

describe('AgentCard direct retirement', () => {
  it('opens and cancels without a request even when model peer agents are disabled', async () => {
    render(AgentCard, { agentId, workspace });
    await openConfirmation();
    expect(backend.requests).toEqual([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(backend.requests).toEqual([]);
    expect(selectAgentSession.select(store.state, agentId)?.retiredAt).toBeUndefined();
  });

  it('confirms one exact retirement request, never sends a model message, and applies the timestamp', async () => {
    let resolve!: (value: unknown) => void;
    backend.onRequest(
      'agent.retire',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(AgentCard, { agentId, workspace });
    await openConfirmation();
    const confirm = screen.getByRole('button', { name: 'Retire Agent' });
    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    expect(selectAgentSession.select(store.state, agentId)?.retiredAt).toBeUndefined();
    expect(backend.requests).toEqual([
      { method: 'agent.retire', params: { agentId, workspaceId: workspace.id } },
    ]);
    resolve({ success: true, retiredAt });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(selectAgentSession.select(store.state, agentId)?.retiredAt).toBe(retiredAt);
    await openMenu();
    await waitFor(() => expect(screen.queryByText('Retire Agent')).toBeNull());
  });

  it('keeps the row active and shows the wire failure', async () => {
    backend.onRequest('agent.retire', () => {
      throw new Error('A descendant is running');
    });
    render(AgentCard, { agentId, workspace });
    await openConfirmation();
    await fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }));
    expect((await screen.findByRole('alert')).textContent).toContain('A descendant is running');
    expect(selectAgentSession.select(store.state, agentId)?.retiredAt).toBeUndefined();
  });

  it.each(['retired', 'collaborator', 'read-only'])(
    'withholds retirement for %s cards',
    async (state) => {
      if (state === 'retired') {
        store.dispatch(removeSession(agentId));
        seed({ retiredAt });
      }
      if (state === 'collaborator')
        store.dispatch(replaceWorkspaceList([{ ...workspace, myRole: 'collaborator' }]));
      render(AgentCard, { agentId, workspace, readOnly: state === 'read-only' });
      await openMenu();
      await waitFor(() => expect(screen.queryByText('Retire Agent')).toBeNull());
      expect(backend.requests).toEqual([]);
    },
  );
});

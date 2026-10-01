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
import RetireAgentModal from '$lib/components/modals/RetireAgentModal.svelte';
import { store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { agentRetirementSupportRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
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
  backend.onRequest('client.hello', () => ({ server: { capabilities: { agentRetire: 1 } } }));
  store.dispatch(connectionStatusChanged('connected'));
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
    expect(backend.requests.filter((r) => r.method !== 'client.hello')).toEqual([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(backend.requests.filter((r) => r.method !== 'client.hello')).toEqual([]);
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
    await waitFor(() =>
      expect(backend.requests.filter((r) => r.method !== 'client.hello')).toEqual([
        { method: 'agent.retire', params: { agentId, workspaceId: workspace.id } },
      ]),
    );
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

  it('lets a collaborator confirm retirement and surfaces authorization failures', async () => {
    store.dispatch(replaceWorkspaceList([{ ...workspace, myRole: 'collaborator' }]));
    backend.onRequest('agent.retire', () => {
      throw new Error('Forbidden: membership revoked');
    });
    render(AgentCard, { agentId, workspace });
    await openConfirmation();
    await fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Forbidden');
    expect(selectAgentSession.select(store.state, agentId)?.retiredAt).toBeUndefined();
  });

  it.each(['success', 'failure'])(
    'ignores an old %s after the retirement dialog changes workspace and agent',
    async (result) => {
      const pending = Promise.withResolvers<unknown>();
      backend.onRequest('agent.retire', () => pending.promise);
      const view = render(RetireAgentModal, {
        open: true,
        workspaceId: workspace.id,
        agentId,
        agentName: 'First agent',
      });
      await fireEvent.click(await screen.findByRole('button', { name: 'Retire Agent' }));
      await waitFor(() =>
        expect(backend.requests.filter((request) => request.method === 'agent.retire')).toEqual([
          { method: 'agent.retire', params: { agentId, workspaceId: workspace.id } },
        ]),
      );
      await view.rerender({
        open: true,
        workspaceId: 'other-workspace',
        agentId: 'other-agent',
        agentName: 'Next agent',
      });
      if (result === 'success') pending.resolve({ success: true, retiredAt });
      else pending.reject(new Error('Old consumer failure'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        (screen.getByRole('button', { name: 'Retire Agent' }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(backend.requests.filter((request) => request.method === 'agent.retire')).toHaveLength(
        1,
      );
    },
  );

  it('releases an unmounted dialog so its late error cannot poison a remounted consumer', async () => {
    const pending = Promise.withResolvers<unknown>();
    backend.onRequest('agent.retire', () => pending.promise);
    const props = { open: true, workspaceId: workspace.id, agentId, agentName: 'First agent' };
    const view = render(RetireAgentModal, props);
    await fireEvent.click(await screen.findByRole('button', { name: 'Retire Agent' }));
    await waitFor(() =>
      expect(backend.requests.filter((request) => request.method === 'agent.retire')).toHaveLength(
        1,
      ),
    );
    view.unmount();
    render(RetireAgentModal, props);
    pending.reject(new Error('Unmounted consumer failure'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('alert')).toBeNull();
    backend.onRequest('agent.retire', () => ({ success: true, retiredAt }));
    await fireEvent.click(screen.getByRole('button', { name: 'Retire Agent' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(backend.requests.filter((request) => request.method === 'agent.retire')).toHaveLength(2);
  });

  it.each(['retired', 'unsupported', 'read-only'])(
    'withholds retirement for %s cards',
    async (state) => {
      if (state === 'retired') {
        store.dispatch(removeSession(agentId));
        seed({ retiredAt });
      }
      if (state === 'unsupported') {
        backend.onRequest('client.hello', () => ({ server: { capabilities: {} } }));
        await store.dispatch(agentRetirementSupportRequested());
      }
      render(AgentCard, { agentId, workspace, readOnly: state === 'read-only' });
      await openMenu();
      await waitFor(() => expect(screen.queryByText('Retire Agent')).toBeNull());
      expect(backend.requests.filter((r) => r.method !== 'client.hello')).toEqual([]);
    },
  );
});

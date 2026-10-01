/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', async () => {
  return (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule;
});
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import RetireAgentModal from '../RetireAgentModal.svelte';

const workspaceId = 'retire-modal-workspace';
const agentId = 'retire-modal-agent';
const retiredAt = '2026-09-28T08:00:00Z';
let backend: MockBackendHandle;
let stop: () => void;
function mount() {
  render(RetireAgentModal, {
    open: true,
    agentName: 'Backend Coordinator',
    workspaceId,
    agentId,
  });
}
const retirementRequests = () => backend.requests.filter(({ method }) => method === 'agent.retire');

beforeEach(() => {
  store.init();
  backend = installMockBackend();
  backend.onRequest('client.hello', () => ({ server: { capabilities: { agentRetire: 1 } } }));
  backend.onRequest('agent.retire', () => ({ success: true, retiredAt }));
  stop = store.runSaga(agentMutationSaga);
});
afterEach(() => {
  stop();
  resetMockBackend();
});

describe('RetireAgentModal', () => {
  it.each(['Cancel', 'Escape', 'Close dialog'])(
    'dismisses via %s without retiring',
    async (dismiss) => {
      mount();
      const dialog = await screen.findByRole('dialog');
      expect(retirementRequests()).toEqual([]);
      if (dismiss === 'Escape') await fireEvent.keyDown(dialog, { key: 'Escape' });
      else await fireEvent.click(screen.getByRole('button', { name: dismiss, exact: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(retirementRequests()).toEqual([]);
    },
  );

  it('confirms once, blocks repeated activation and dismissal while pending, and closes on success', async () => {
    const pending = Promise.withResolvers<{ success: true; retiredAt: string }>();
    backend.onRequest('agent.retire', () => pending.promise);
    mount();
    const confirm = await screen.findByRole('button', { name: 'Retire Agent' });
    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    await waitFor(() =>
      expect(retirementRequests()).toEqual([
        { method: 'agent.retire', params: { workspaceId, agentId } },
      ]),
    );
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    pending.resolve({ success: true, retiredAt });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the daemon error, keeps the dialog open, and allows retry', async () => {
    backend.onRequest('agent.retire', () => {
      throw new Error('A descendant is running');
    });
    mount();
    const confirm = await screen.findByRole('button', { name: 'Retire Agent' });
    await fireEvent.click(confirm);
    expect((await screen.findByRole('alert')).textContent).toContain('A descendant is running');
    expect(screen.getByRole('dialog')).toBeTruthy();
    backend.onRequest('agent.retire', () => ({ success: true, retiredAt }));
    await fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(retirementRequests()).toEqual([
      { method: 'agent.retire', params: { workspaceId, agentId } },
      { method: 'agent.retire', params: { workspaceId, agentId } },
    ]);
  });
});

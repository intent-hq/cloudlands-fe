/**
 * @vitest-environment jsdom
 */
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
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { agentMutationUiRequested } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-slice';
import { selectAgentMutationUi } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-selectors';
import { notify } from '$lib/components/patterns/notify';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

const workspaceId = 'workspace-agent-card-rename';
let sequence = 0;
let agentId = '';
let backend: MockBackendHandle;
let stop: () => void;

function session(): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId(workspaceId),
    name: 'Original Agent',
    nameExplicitlySet: false,
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  } as AgentSession;
}

async function beginRename(props: Record<string, unknown> = {}) {
  const onActivate = vi.fn();
  const view = render(AgentCard, {
    props: { agentId, agentName: 'Original Agent', onclick: onActivate, ...props },
  });
  const row = view.container.querySelector<HTMLElement>('[data-agent-panel-row], button');
  expect(row).not.toBeNull();
  await fireEvent.contextMenu(row!);
  await fireEvent.click(await screen.findByText('Rename'));
  const input = await screen.findByRole('textbox', { name: 'Rename' });
  return { ...view, input: input as HTMLInputElement, onActivate };
}

describe('AgentCard rename editing', () => {
  beforeEach(() => {
    appStore.init();
    backend = installMockBackend();
    backend.onRequest('agent.rename', (params) => ({ success: true, name: params.name }));
    stop = appStore.runSaga(agentMutationSaga);
    agentId = `agent-card-rename-${++sequence}`;
    appStore.dispatch(bulkUpsertSessions([session()]));
  });

  afterEach(() => {
    cleanup();
    stop();
    appStore.dispatch(removeSession(agentId));
    resetMockBackend();
    vi.restoreAllMocks();
  });

  it.each([
    ['expanded', {}],
    ['inline', { inline: true }],
    ['panel row', { panelRow: true, hidePreview: true }],
  ])('replaces the activation button with a labelled input in %s mode', async (_, props) => {
    const { input, onActivate } = await beginRename(props);
    const editRow = input.closest('[data-agent-panel-row], [data-testid="agent-list-item"] > div');

    expect(input.closest('button')).toBeNull();
    expect(editRow?.tagName).toBe('DIV');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it.each(['ContextMenu', 'F10'])(
    'opens context actions with %s without activating the card',
    async (key) => {
      const onActivate = vi.fn();
      const view = render(AgentCard, {
        props: { agentId, agentName: 'Original Agent', onclick: onActivate, panelRow: true },
      });
      const row = view.container.querySelector<HTMLElement>('[data-agent-panel-row]')!;
      row.focus();
      await fireEvent.keyDown(row, { key, shiftKey: key === 'F10' });
      const rename = await screen.findByRole('menuitem', { name: 'Rename' });
      expect(onActivate).not.toHaveBeenCalled();
      await fireEvent.click(rename);
      const input = await screen.findByRole('textbox', { name: 'Rename' });
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(onActivate).not.toHaveBeenCalled();
    },
  );

  it('isolates normal editing keys and pointer events without cancelling browser defaults', async () => {
    const { container, input, onActivate } = await beginRename({ panelRow: true });
    const escaped = vi.fn();
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'contextmenu']) {
      container.addEventListener(type, escaped);
    }

    const keys = [' ', 'a', '7', '.', 'ArrowLeft', 'Home', 'End', 'Backspace', 'Delete'];
    for (const key of keys) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const [key, modifier] of [
      ['c', { metaKey: true }],
      ['x', { ctrlKey: true }],
      ['v', { metaKey: true }],
      ['z', { metaKey: true }],
      ['z', { metaKey: true, shiftKey: true }],
    ] as const) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifier,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await fireEvent.pointerDown(input);
    await fireEvent.pointerUp(input);
    await fireEvent.click(input);
    await fireEvent.contextMenu(input);

    expect(escaped).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('trims only outer whitespace and commits the exact internal-space name once', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const { input, onActivate } = await beginRename({ panelRow: true });
    await fireEvent.input(input, { target: { value: '  Alpha  Beta  42!  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(backend.requests.filter((request) => request.method === 'agent.rename')).toEqual([
        { method: 'agent.rename', params: { workspaceId, agentId, name: 'Alpha  Beta  42!' } },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-name').textContent).toBe('Alpha  Beta  42!'),
    );
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull();
    const request = dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === agentMutationUiRequested.type) as ReturnType<
      typeof agentMutationUiRequested
    >;
    expect(request).toBeDefined();
    await waitFor(() =>
      expect(
        selectAgentMutationUi.select(appStore.state, workspaceId, request.payload[1]),
      ).toBeUndefined(),
    );
  });

  it('cancels on Escape and does not commit composing Enter', async () => {
    const first = await beginRename({ panelRow: true });
    await fireEvent.input(first.input, { target: { value: 'Composing name' } });
    await fireEvent.keyDown(first.input, { key: 'Enter', isComposing: true });
    expect(screen.getByRole('textbox', { name: 'Rename' })).toBe(first.input);

    await fireEvent.keyDown(first.input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull();
    expect(backend.requests.filter((request) => request.method === 'agent.rename')).toEqual([]);
  });

  it('commits blur once and reverts the optimistic name when rename fails', async () => {
    const pending = Promise.withResolvers<never>();
    backend.onRequest('agent.rename', () => pending.promise);
    const { input } = await beginRename();
    await fireEvent.input(input, { target: { value: 'Temporary Name' } });
    await fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-name').textContent).toBe('Temporary Name'),
    );

    pending.reject(new Error('rename failed'));
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-name').textContent).toBe('Original Agent'),
    );
    expect(backend.requests.filter((request) => request.method === 'agent.rename')).toEqual([
      { method: 'agent.rename', params: { workspaceId, agentId, name: 'Temporary Name' } },
    ]);
  });

  it('retains rename failure feedback after Stop finishes on the same mounted card', async () => {
    const pending = Promise.withResolvers<never>();
    const error = vi.spyOn(notify, 'error').mockImplementation(() => 'toast-id');
    backend.onRequest('agent.rename', () => pending.promise);
    backend.onRequest('agent.stop', () => ({ success: true }));
    appStore.dispatch(bulkUpsertSessions([{ ...session(), status: AgentStatus.Active }]));
    const { container, input } = await beginRename({ panelRow: true });
    await fireEvent.input(input, { target: { value: 'Pending rename' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-name').textContent).toBe('Pending rename'),
    );
    await fireEvent.contextMenu(container.querySelector('[data-agent-panel-row]')!);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Stop' })).toBeNull());
    expect(backend.requests.filter(({ method }) => method === 'agent.stop')).toEqual([
      { method: 'agent.stop', params: { workspaceId, agentId } },
    ]);
    pending.reject(new Error('Rename rejected after Stop'));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('agent-card-name').textContent).toBe('Original Agent');
    expect(backend.requests.filter(({ method }) => method === 'agent.rename')).toEqual([
      { method: 'agent.rename', params: { workspaceId, agentId, name: 'Pending rename' } },
    ]);
  });
});

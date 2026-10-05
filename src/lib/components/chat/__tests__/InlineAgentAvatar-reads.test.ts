/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';
import { appClient } from '$lib/client';
import { LiveAgentsClient } from '$lib/client/live/live-agents-client';
import { store as appStore } from '$store/renderer/store';
import { agentReadSaga } from '$store/renderer/slices/workspace-agents/sagas/agent-read-saga';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import InlineAgentAvatar from '../InlineAgentAvatar.svelte';

let sequence = 0;
let agentId: string;
let backend: MockBackendHandle;
let stopReadSaga: (() => void) | undefined;
let disposeStore: (() => void) | undefined;
const workspace = () => ({ id: WorkspaceId('tiny-owl'), title: 'Chat workspace' }) as Workspace;
const session = (): AgentSession => ({
  id: AgentId(agentId),
  workspaceId: WorkspaceId('tiny-owl'),
  backendSessionId: null,
  name: 'Known agent',
  status: AgentStatus.Active,
  messages: [],
  createdAt: '2026-10-01T01:00:00Z',
  updatedAt: '2026-10-01T01:00:00Z',
});

describe('inline agent avatar reads', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    disposeStore = appStore.init();
    agentId = `avatar-read-${++sequence}`;
    backend = installMockBackend();
    const live = new LiveAgentsClient();
    vi.spyOn(appClient.agents, 'get').mockImplementation((id, wsId) => live.get(id, wsId));
    backend.onRequest('agent.get', () => ({
      agent: {
        id: agentId,
        workspaceId: 'tiny-owl',
        name: 'Fetched agent',
        status: 'active',
        createdAt: '2026-10-01T01:00:00Z',
        updatedAt: '2026-10-01T01:00:00Z',
        messageCount: 0,
      },
    }));
    stopReadSaga = appStore.runSaga(agentReadSaga);
  });
  afterEach(() => {
    cleanup();
    stopReadSaga?.();
    appStore.dispatch(removeSession(agentId));
    disposeStore?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetMockBackend();
  });

  it('uses an existing session across mount, pointer hover and refreshed workspace objects', async () => {
    appStore.dispatch(bulkUpsertSessions([session()]));
    const view = render(InlineAgentAvatar, {
      props: { agentId, workspace: workspace(), onclick: vi.fn() },
    });
    const avatar = screen.getByRole('button');
    for (let i = 0; i < 3; i++) {
      await fireEvent.pointerEnter(avatar, { pointerType: 'mouse' });
      await fireEvent.pointerLeave(avatar, { pointerType: 'mouse' });
      await view.rerender({ workspace: workspace() });
      await tick();
    }
    expect(backend.requests).toEqual([]);
    expect(avatar.getAttribute('aria-label')).toContain('Known agent');
  });

  it('loads the same agent identity in a fresh renderer on another backend', async () => {
    appStore.dispatch(bulkUpsertSessions([session()]));
    const first = render(InlineAgentAvatar, {
      props: { agentId, workspace: workspace(), onclick: vi.fn() },
    });
    expect(backend.requests).toEqual([]);
    first.unmount();
    stopReadSaga?.();
    const connections = { ...appStore.state.connections, windowBackendId: 'remote-backend' };
    disposeStore?.();
    // Backend identity is fixed per window. A new renderer owns a fresh store,
    // even when the backend exposes the same workspace and agent IDs.
    disposeStore = appStore.init({ connections });
    expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
    stopReadSaga = appStore.runSaga(agentReadSaga);
    render(InlineAgentAvatar, {
      props: { agentId, workspace: workspace(), onclick: vi.fn() },
    });
    await waitFor(() =>
      expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Fetched agent'),
    );
    expect(backend.requests).toEqual([
      { method: 'agent.get', params: { agentId, workspaceId: 'tiny-owl' } },
    ]);
  });

  it('loads a missing preview once and reuses it after a workspace list refresh', async () => {
    const view = render(InlineAgentAvatar, {
      props: { agentId, workspace: workspace(), onclick: vi.fn() },
    });
    await waitFor(() =>
      expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('Fetched agent'),
    );
    expect(backend.requests).toEqual([
      { method: 'agent.get', params: { agentId, workspaceId: 'tiny-owl' } },
    ]);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Fetched agent');
    await view.rerender({ workspace: workspace() });
    await tick();
    expect(backend.requests).toHaveLength(1);
  });
});

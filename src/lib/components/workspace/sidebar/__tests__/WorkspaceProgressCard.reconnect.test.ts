/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Workspace } from '$shared/types';
import type { WorkspaceBrowserClient } from '$shared/types/browser-clients';
import { WorkspaceId } from '$shared/types/branded-ids';

const wire = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  reconnect: new Set<() => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendReconnected: (handler: () => void) => {
    wire.reconnect.add(handler);
    return () => wire.reconnect.delete(handler);
  },
  onBackendNotification: () => () => {},
  backendSubscribe: wire.subscribe,
  backendUnsubscribe: async () => {},
}));
vi.mock('$lib/components/workspace/TaskStatusIndicator.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('../FlameGraph.svelte', async () => ({
  default: (await import('./mocks/MockFlameGraph.svelte')).default,
}));

import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { principalSaga } from '$store/renderer/slices/principal/sagas/principal-saga';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { browserClientsSaga } from '$store/renderer/slices/browser-clients/sagas/browser-clients-saga';
import { workspaceReconnectSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/workspace-reconnect-saga';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { refreshLiveClientsRequested } from '$store/renderer/slices/browser-clients/browser-clients-slice';
import { __resetOwnClientIdForTesting } from '$lib/client/live/live-clients-client';
import WorkspaceProgressCard from '../WorkspaceProgressCard.svelte';

const own = 'exact-desktop';
const principalRetryWait = { timeout: 3000 };
const workspace = {
  id: WorkspaceId('ws-1'),
  title: 'Recovery fixture',
  status: 'active',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: '2026-10-09T00:00:00Z',
  updatedAt: '2026-10-09T00:00:00Z',
} as Workspace;
let resolution: WorkspaceBrowserClient;
let dispose: () => void;
let cancels: (() => void)[];
let role: 'owner' | 'guest';

async function capabilities() {
  await waitFor(() => expect(store.state.principal.status).toBe('ready'));
  store.dispatch(replaceWorkspaceList([workspace]));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  await tick();
}

beforeEach(() => {
  wire.subscribe.mockReset().mockResolvedValue({ subscriptionId: 'fixture-subscription' });
  role = 'owner';
  resolution = { source: 'workspace', clientId: own, resolved: { clientId: own } };
  wire.request
    .mockReset()
    .mockImplementation(async (method: string, params: { clientId?: string }) => {
      if (method === 'client.hello')
        return { clientId: own, server: { capabilities: { hostMembership: 1 } } };
      if (method === 'principal.me')
        return {
          id: 'person',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: role === 'owner',
          hostRole: role,
          hostMembershipRevision: 1,
        };
      if (method === 'client.list')
        return {
          clients: [
            {
              clientId: own,
              capabilities: { browserExec: true },
              connections: 1,
              transports: ['wss'],
              connectedAt: '2026-10-09T00:00:00Z',
            },
          ],
        };
      if (method === 'workspace.getBrowserClient') return { browserClient: resolution };
      if (method === 'workspace.setBrowserClient') {
        resolution = {
          source: 'workspace',
          clientId: params.clientId!,
          resolved: { clientId: params.clientId! },
        };
        return { browserClient: resolution };
      }
      throw new Error(`Unexpected request ${method}`);
    });
  dispose = store.init();
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  cancels = [principalSaga, workspaceReconnectSaga, browserClientsSaga, daemonEventsSaga].map(
    (saga) => store.runSaga(saga),
  );
});

afterEach(() => {
  cleanup();
  cancels.forEach((cancel) => cancel());
  dispose();
  __resetOwnClientIdForTesting();
});

async function mount() {
  await capabilities();
  store.dispatch(workspaceMounted('ws-1'));
  const view = render(WorkspaceProgressCard, { workspaceId: workspace.id });
  await waitFor(() =>
    expect(store.state.browserClients.byWorkspaceId['ws-1']?.browserClient).toEqual(resolution),
  );
  await fireEvent.click(view.container.querySelector('[data-workspace-actions-trigger]')!);
  return view;
}
const primary = () => screen.getByText('Set primary client');
const writes = () =>
  wire.request.mock.calls.filter(([method]) => method === 'workspace.setBrowserClient');
async function reconnect(reverse = false) {
  const previous = selectPrincipalActionContext.select(store.state);
  store.dispatch(connectionStatusChanged('disconnected'));
  store.dispatch(connectionStatusChanged('connected'));
  const callbacks = [...wire.reconnect];
  if (reverse) callbacks.reverse();
  for (const handler of callbacks) handler();
  await waitFor(() => {
    const current = selectPrincipalActionContext.select(store.state);
    expect(current).not.toBeNull();
    expect(current).not.toBe(previous);
  });
  await capabilities();
}

describe('actual browser lifecycle to primary menu', () => {
  it('enables recovery after delayed startup status cancels the first hello', async () => {
    cancels.forEach((cancel) => cancel());
    dispose();
    // Model first startup: subscription and browser hello are still pending,
    // and no connected status has been observed yet.
    let subscribe!: (value: unknown) => void;
    wire.subscribe.mockReturnValue(
      new Promise((resolve) => {
        subscribe = resolve;
      }),
    );
    dispose = store.init();
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    cancels = [principalSaga, workspaceReconnectSaga, browserClientsSaga, daemonEventsSaga].map(
      (saga) => store.runSaga(saga),
    );
    const normal = wire.request.getMockImplementation()!;
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let first = true;
    wire.request.mockImplementation((method, params) => {
      if (method === 'client.hello' && first) {
        first = false;
        return pending;
      }
      return normal(method, params);
    });
    resolution = { source: 'default', resolved: null };
    store.dispatch(workspaceMounted('ws-1'));
    const view = render(WorkspaceProgressCard, { workspaceId: workspace.id });
    await waitFor(() => expect(first).toBe(false));
    store.dispatch(connectionStatusChanged('connecting'));
    store.dispatch(connectionStatusChanged('connected'));
    release({ clientId: own });
    subscribe({ subscriptionId: 'first-subscription' });
    await capabilities();
    await fireEvent.click(view.container.querySelector('[data-workspace-actions-trigger]')!);
    await waitFor(() =>
      expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(false),
    );
    await fireEvent.click(primary());
    await fireEvent.click(screen.getByRole('button', { name: 'Set as Primary' }));
    await waitFor(() =>
      expect(writes()).toEqual([
        ['workspace.setBrowserClient', { workspaceId: 'ws-1', clientId: own }],
      ]),
    );
  });

  it('recovers on remount after current browser admission fails during reconnect', async () => {
    const view = await mount();
    const normal = wire.request.getMockImplementation()!;
    let failBrowserHello = true;
    wire.request.mockImplementation((method, params) => {
      if (method === 'client.hello' && failBrowserHello) {
        return Promise.reject(new Error('temporary browser hello failure'));
      }
      return normal(method, params);
    });
    resolution = { source: 'default', resolved: null };
    store.dispatch(connectionStatusChanged('disconnected'));
    store.dispatch(connectionStatusChanged('connected'));
    for (const handler of wire.reconnect) handler();
    await waitFor(() => expect(store.state.principal.error).toBe('unavailable'));
    expect(store.state.browserClients.ownClientId).toBe(own);
    expect(store.state.browserClients.ownClientIdConfirmed).toBe(false);
    expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
    expect(writes()).toEqual([]);
    view.unmount();
    store.dispatch(workspaceUnmounted('ws-1'));
    failBrowserHello = false;
    store.dispatch(workspaceMounted('ws-1'));
    await waitFor(() => expect(store.state.principal.status).toBe('ready'), principalRetryWait);
    await mount();
    await waitFor(() =>
      expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(false),
    );
    await fireEvent.click(primary());
    await fireEvent.click(screen.getByRole('button', { name: 'Set as Primary' }));
    await waitFor(() =>
      expect(writes()).toEqual([
        ['workspace.setBrowserClient', { workspaceId: 'ws-1', clientId: own }],
      ]),
    );
  });

  it.each([false, true])(
    'recovers a missed pin event across repeated reconnects (reverse callbacks: %s)',
    async (reverse) => {
      const view = await mount();
      expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
      resolution = { source: 'default', resolved: { clientId: own } };
      await reconnect(reverse);
      await reconnect(reverse);
      await waitFor(() =>
        expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(false),
      );
      await fireEvent.click(primary());
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(writes()).toEqual([]);
      await fireEvent.click(view.container.querySelector('[data-workspace-actions-trigger]')!);
      await fireEvent.click(primary());
      await fireEvent.click(screen.getByRole('button', { name: 'Set as Primary' }));
      await waitFor(() =>
        expect(writes()).toEqual([
          ['workspace.setBrowserClient', { workspaceId: 'ws-1', clientId: own }],
        ]),
      );
    },
  );

  it('retains a true self pin as unavailable after same-ID reconnect', async () => {
    await mount();
    await reconnect();
    await waitFor(() => expect(store.state.browserClients.ownClientId).toBe(own));
    expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('cannot confirm a dialog from the previous admitted connection', async () => {
    resolution = { source: 'default', resolved: null };
    await mount();
    await fireEvent.click(primary());
    await reconnect();
    await fireEvent.click(screen.getByRole('button', { name: 'Set as Primary' }));
    expect(writes()).toEqual([]);
  });

  it('waits for the current resolution even after the eligible roster arrives', async () => {
    await mount();
    const normal = wire.request.getMockImplementation()!;
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    wire.request.mockImplementation((method, params) =>
      method === 'workspace.getBrowserClient' ? pending : normal(method, params),
    );
    resolution = { source: 'default', resolved: null };
    await reconnect();
    await waitFor(() =>
      expect(store.state.browserClients.byWorkspaceId['ws-1'].liveClientsLoaded).toBe(true),
    );
    expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
    release({ browserClient: resolution });
    await waitFor(() =>
      expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(false),
    );
  });

  it('requires a fresh exact identity even when roster and resolution refresh first', async () => {
    await mount();
    const normal = wire.request.getMockImplementation()!;
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let holdBrowserHello = true;
    wire.request.mockImplementation((method, params) => {
      if (method === 'client.hello' && holdBrowserHello) {
        holdBrowserHello = false;
        return pending;
      }
      return normal(method, params);
    });
    resolution = { source: 'default', resolved: null };
    await reconnect();
    store.dispatch(refreshLiveClientsRequested('ws-1'));
    await waitFor(() =>
      expect(store.state.browserClients.byWorkspaceId['ws-1'].liveClientsLoaded).toBe(true),
    );
    expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
    release({ clientId: own });
    await waitFor(() =>
      expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(false),
    );
  });

  it('keeps recovery denied after current principal hydration removes host authority', async () => {
    await mount();
    resolution = { source: 'default', resolved: null };
    role = 'guest';
    await reconnect();
    expect(primary().closest('[role^="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
    await fireEvent.click(primary());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('does not carry workspace authority into another window backend', async () => {
    resolution = { source: 'default', resolved: null };
    await mount();
    await fireEvent.click(primary());
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'other', windowBackendId: 'other' }),
    );
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Set as Primary' }));
    expect(writes()).toEqual([]);
  });
});

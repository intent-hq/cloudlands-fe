import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '$store/renderer/types';
import {
  clearRendererStoreBridge,
  getRendererStore,
  initRendererStoreBridge,
  type RendererStoreBridge,
} from '$store/renderer/renderer-store-bridge';
import {
  initialState as workspaceInitialState,
  workspaceReducer,
  workspaceReminderInvalidated,
} from '$store/renderer/slices/workspace/workspace-slice';
import { createAdmittedLegacyPrincipal } from '../../../test/fixtures/admitted-legacy-principal';

// Keep RPCs and transport selection fake; exercise the real captured read context
// and renderer-store bridge without connecting to a daemon.
const transport = vi.hoisted(() => ({ binding: {} }));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: () => transport.binding,
}));
vi.mock('./backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backend-transport')>()),
  backendRequest: vi.fn(),
}));

import { backendRequest } from './backend-transport';
import { LiveWorkspacesClient } from './live-workspaces-client';

type ReadState = Pick<
  StoreState,
  'connections' | 'daemonHealth' | 'workspaceEvents' | 'principal' | 'workspace'
>;
type Page = { workspaces: Array<{ id: string; title: string }>; nextToken?: string | null };
const mockedRequest = vi.mocked(backendRequest);
const row = (id: string) => ({ id, title: id });

describe('workspace list pagination across read ownership changes', () => {
  let state: ReadState;
  let bridge: RendererStoreBridge;
  let previousBridge: RendererStoreBridge | undefined;

  beforeEach(() => {
    mockedRequest.mockReset();
    transport.binding = {};
    const admitted = createAdmittedLegacyPrincipal({
      connections: { windowBackendId: 'host-a' },
      daemonHealth: { connectionGeneration: 1 },
    });
    const snapshot = admitted.principal.snapshot;
    if (!snapshot) throw new Error('Expected an admitted principal fixture');
    state = {
      ...admitted,
      principal: {
        ...admitted.principal,
        boundPrincipalId: 'person-a',
        snapshot: {
          ...snapshot,
          principal: {
            ...snapshot.principal,
            id: 'person-a',
            hostRole: 'owner',
            hostMembershipRevision: 1,
          },
          capabilities: { ...snapshot.capabilities, hostMembership: true },
        },
      },
      workspace: { ...workspaceInitialState },
    };
    previousBridge = undefined;
    try {
      previousBridge = getRendererStore();
    } catch {
      // A renderer root is optional in client-only tests.
    }
    clearRendererStoreBridge(previousBridge);
    bridge = {
      // This fixture supplies every slice used by the real read context.
      get state() {
        return state as StoreState;
      },
      dispatch: vi.fn(),
    };
    initRendererStoreBridge(bridge);
  });

  afterEach(() => {
    clearRendererStoreBridge(bridge);
    if (previousBridge) initRendererStoreBridge(previousBridge);
    vi.clearAllMocks();
  });

  function changePrincipal() {
    const snapshot = state.principal.snapshot;
    if (!snapshot) throw new Error('Expected an admitted principal fixture');
    state = {
      ...state,
      principal: {
        ...state.principal,
        boundPrincipalId: 'person-b',
        snapshot: {
          ...snapshot,
          principal: {
            ...snapshot.principal,
            id: 'person-b',
            hostRole: 'guest',
            isAdministrator: false,
            hostMembershipRevision: 2,
          },
        },
      },
    };
  }

  it('collects every page while retaining archive and retired scope', async () => {
    mockedRequest
      .mockResolvedValueOnce({ workspaces: [row('first-workspace')], nextToken: 'second-page' })
      .mockResolvedValueOnce({ workspaces: [row('second-workspace')], nextToken: null });

    const rows = await new LiveWorkspacesClient().list({
      includeArchived: true,
      includeRetired: true,
    });

    expect(rows.map(({ id }) => id)).toEqual(['first-workspace', 'second-workspace']);
    expect(mockedRequest.mock.calls).toEqual([
      ['workspace.list', { includeArchived: true, includeRetired: true }],
      ['workspace.list', { includeArchived: true, includeRetired: true, nextToken: 'second-page' }],
    ]);
  });

  it.each(['principal', 'transport'] as const)(
    'does not send a continuation after the %s changes between pages',
    async (owner) => {
      const first = Promise.withResolvers<Page>();
      mockedRequest.mockReturnValueOnce(first.promise);
      const pending = new LiveWorkspacesClient().list();
      const rejected = expect(pending).rejects.toThrow('WORKSPACE_READ_RETIRED');

      first.resolve({ workspaces: [row('obsolete')], nextToken: 'old-owner-token' });
      // The first page settles before the collector resumes for its continuation.
      queueMicrotask(() => {
        if (owner === 'principal') changePrincipal();
        else transport.binding = {};
      });

      await rejected;
      expect(mockedRequest.mock.calls).toEqual([['workspace.list', undefined]]);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'retires an old page on %s without clearing a newer caller request',
    async (settlement) => {
      const oldPage = Promise.withResolvers<Page>();
      const secondPageStarted = Promise.withResolvers<void>();
      const freshPage = Promise.withResolvers<Page>();
      mockedRequest
        .mockResolvedValueOnce({ workspaces: [row('old-first')], nextToken: 'old-second' })
        .mockImplementationOnce(() => {
          secondPageStarted.resolve();
          return oldPage.promise;
        })
        .mockReturnValueOnce(freshPage.promise);
      const client = new LiveWorkspacesClient();
      const obsolete = client.list();
      const rejected = expect(obsolete).rejects.toThrow('WORKSPACE_READ_RETIRED');
      await secondPageStarted.promise;

      changePrincipal();
      const current = client.list();
      if (settlement === 'resolve') {
        oldPage.resolve({ workspaces: [row('private-old-row')], nextToken: 'old-third' });
      } else {
        oldPage.reject(new Error('Private error from the previous caller'));
      }
      await rejected;

      expect(client.list()).toBe(current);
      expect(mockedRequest.mock.calls).toEqual([
        ['workspace.list', undefined],
        ['workspace.list', { nextToken: 'old-second' }],
        ['workspace.list', undefined],
      ]);
      freshPage.resolve({ workspaces: [row('new-caller')], nextToken: null });
      await expect(current.then((rows) => rows.map(({ id }) => id))).resolves.toEqual([
        'new-caller',
      ]);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'restarts the complete list after reminder invalidation on page %s',
    async (settlement) => {
      const obsoletePage = Promise.withResolvers<Page>();
      mockedRequest
        .mockReturnValueOnce(obsoletePage.promise)
        .mockResolvedValueOnce({ workspaces: [row('fresh-first')], nextToken: 'fresh-second' })
        .mockResolvedValueOnce({ workspaces: [row('fresh-second')], nextToken: null });
      const pending = new LiveWorkspacesClient().list({ includeArchived: true });
      state = {
        ...state,
        workspace: workspaceReducer(state.workspace, workspaceReminderInvalidated('changed')),
      };
      if (settlement === 'resolve') {
        obsoletePage.resolve({ workspaces: [row('obsolete')], nextToken: 'obsolete-token' });
      } else {
        obsoletePage.reject(new Error('Old reminder read failed'));
      }

      await expect(pending.then((rows) => rows.map(({ id }) => id))).resolves.toEqual([
        'fresh-first',
        'fresh-second',
      ]);
      expect(mockedRequest.mock.calls).toEqual([
        ['workspace.list', { includeArchived: true }],
        ['workspace.list', { includeArchived: true }],
        ['workspace.list', { includeArchived: true, nextToken: 'fresh-second' }],
      ]);
    },
  );
});

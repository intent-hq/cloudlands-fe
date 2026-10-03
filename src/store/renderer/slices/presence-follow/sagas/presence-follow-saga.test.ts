import { take, type SagaGenerator } from 'typed-redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { HostRole } from '$shared/types/principal';
import type { PresenceFocusItem } from '$shared/types/presence';
import { store } from '../../../store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { principalContextChanged, principalReceived } from '../../principal/principal-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { selectPresenceContext } from '../../presence/presence-selectors';
import {
  presenceContextReceived,
  presenceWorkspacesReceived,
  presenceMembersReceived,
  presenceRosterReceived,
} from '../../presence/presence-slice';
import { followPresencePersonRequested } from '../presence-follow-slice';
import { selectPresenceFollowTargets } from '../presence-follow-selectors';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  openWorkspaceNote,
  openWorkspaceFile,
} from '../../workspace-navigation/workspace-navigation-slice';
import {
  setActiveTab,
  focusPanel,
  selectNextTab,
  goBack,
} from '../../panel-layout/panel-layout-slice';
import { presenceFollowSaga } from './presence-follow-saga';

const wire = vi.hoisted(() => ({
  request: vi.fn(),
  goto: vi.fn(),
  hydrate: vi.fn(),
  listeners: new Set<(n: { method: string; params: unknown }) => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendNotification: (fn: (n: { method: string; params: unknown }) => void) => {
    wire.listeners.add(fn);
    return () => wire.listeners.delete(fn);
  },
}));
vi.mock('$app/navigation', () => ({ goto: wire.goto }));
vi.mock('../../panel-layout/sagas/panel-layout-saga', () => ({
  hydrateWorkspaceLayout: wire.hydrate,
}));
const settle = () => vi.advanceTimersByTimeAsync(0);
let destination: PresenceFocusItem | null;
let serial: number;
const subscriptions = new Map<string, { workspaceId: string; principalId: string }>();
function push(id: string, seq: number, target: PresenceFocusItem | null, closed?: true) {
  const params = subscriptions.get(id)!;
  for (const fn of wire.listeners)
    fn({
      method: 'subscription.push',
      params: {
        subscriptionId: id,
        seq,
        kind: 'snapshot',
        snapshot: { ...params, target, ...(closed ? { closed } : {}) },
      },
    });
}
const member = (principalId: string) => ({
  principalId,
  hostRole: 'guest' as const,
  role: 'collaborator' as const,
  login: 'same-handle',
  displayName: null,
  avatarUrl: null,
  addedAt: '2026-10-03T00:00:00Z',
});
function workspaces(includeDestination = true) {
  return [
    { id: WorkspaceId('source'), title: 'Source', memberCount: 4, myRole: 'collaborator' },
    ...(includeDestination
      ? [
          {
            id: WorkspaceId('closed'),
            title: 'Destination',
            memberCount: 2,
            myRole: 'collaborator',
          },
        ]
      : []),
  ] as Workspace[];
}
function admit(role: HostRole) {
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
      {
        principal: {
          id: 'viewer',
          hostRole: role,
          hostMembershipRevision: 1,
          isAdministrator: role === 'owner',
          login: null,
          displayName: null,
          avatarUrl: null,
        },
        capabilities: {
          hostMembership: true,
          collaborationIdentity: true,
          personalPairing: true,
          authenticatedDevices: true,
        },
      },
    ),
  );
  store.dispatch(presenceContextReceived(selectPresenceContext.select(store.state)!, 'viewer'));
}
let dispose: () => void;
let cancel: () => void;
let actions: { type: string; payload?: unknown }[];
let cancelCapture: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dispose = store.init();
  serial = 0;
  subscriptions.clear();
  destination = { workspaceId: 'closed', noteId: 'spec' };
  wire.request
    .mockReset()
    .mockImplementation(
      async (
        method: string,
        params: { workspaceId: string; principalId: string; subscriptionId?: string },
      ) => {
        if (method === 'presence.focus.unsubscribe') return { success: true };
        if (method !== 'presence.focus.subscribe') throw Error(`unexpected ${method}`);
        const id = `sub-${++serial}`;
        subscriptions.set(id, { workspaceId: params.workspaceId, principalId: params.principalId });
        push(id, 0, destination);
        return { subscriptionId: id };
      },
    );
  wire.hydrate.mockReset().mockResolvedValue(undefined);
  wire.goto
    .mockReset()
    .mockImplementation(async (path: string, options: { state: App.PageState }) => {
      store.dispatch(
        openWorkspaceTab(
          decodeURIComponent(path.split('/').at(-1)!),
          options.state.presenceFollowRequestId,
        ),
      );
    });
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  store.dispatch(setLabsMultiplayerEnabled(true));
  store.dispatch(replaceWorkspaceList(workspaces()));
  store.dispatch(openWorkspaceTab('source'));
  actions = [];
  cancelCapture = store.runSaga(function* (): SagaGenerator<void> {
    while (true) actions.push(yield* take([openAgentTabRequested, openWorkspaceNote]));
  });
});
afterEach(() => {
  cancel?.();
  cancelCapture();
  dispose();
  vi.useRealTimers();
});
function seedPresence(role: HostRole = 'member', people = ['person']) {
  admit(role);
  store.dispatch(presenceWorkspacesReceived(['source']));
  store.dispatch(presenceMembersReceived('source', people.map(member)));
  store.dispatch(
    presenceRosterReceived({
      workspaceId: 'source',
      members: people.map((id) => ({ ...member(id), focus: [], typing: [] })),
    }),
  );
}
function start(role: HostRole = 'member', people = ['person']) {
  seedPresence(role, people);
  cancel = store.runSaga(presenceFollowSaga);
}
function click() {
  const frame = selectPresenceFollowTargets.select(store.state, 'source').person;
  expect(frame).toBeDefined();
  store.dispatch(
    followPresencePersonRequested(frame.scope, 'person', frame.generation, frame.seq, 'click-1'),
  );
}
const views = () =>
  actions.filter(
    (action) =>
      action.type === openAgentTabRequested.type || action.type === openWorkspaceNote.type,
  );

describe('following authorized presence', () => {
  it.each(['owner', 'member', 'guest'] as const)(
    'follows a closed-tab note for an admitted %s with fresh snapshot checks',
    async (role) => {
      start(role);
      await settle();
      expect(store.state.tabState.openTabs.closed).toBeUndefined();
      click();
      await settle();
      expect(wire.goto).toHaveBeenCalledWith('/workspace/closed', {
        state: { presenceFollowRequestId: 'click-1' },
      });
      expect(views()).toEqual([
        openWorkspaceNote('closed', 'spec', {
          sourcePanelId: undefined,
          openInAdjacentPanel: false,
        }),
      ]);
      expect(
        wire.request.mock.calls.filter(([method]) => method === 'presence.focus.subscribe'),
      ).toHaveLength(3);
      expect(
        wire.request.mock.calls.every(
          ([method, params]) =>
            method === 'presence.focus.unsubscribe' ||
            (method === 'presence.focus.subscribe' &&
              params.workspaceId === 'source' &&
              params.principalId === 'person'),
        ),
      ).toBe(true);
    },
  );
  it('uses the agent action in the same workspace', async () => {
    destination = { workspaceId: 'source', agentId: 'agent' };
    start();
    await settle();
    click();
    await settle();
    expect(wire.goto).not.toHaveBeenCalled();
    expect(views()).toEqual([
      openAgentTabRequested('source', {
        agentId: 'agent',
        sourcePanelId: undefined,
        openInAdjacentPanel: false,
      }),
    ]);
  });
  it('opens a bare workspace without creating a resource tab', async () => {
    destination = { workspaceId: 'closed' };
    start();
    await settle();
    click();
    await settle();
    expect(wire.goto).toHaveBeenCalledWith('/workspace/closed', {
      state: { presenceFollowRequestId: 'click-1' },
    });
    expect(views()).toEqual([]);
    expect(wire.hydrate).not.toHaveBeenCalled();
  });
  it('does not probe hidden destinations or offer an action for a null focus', async () => {
    destination = null;
    start('guest');
    await settle();
    expect(selectPresenceFollowTargets.select(store.state, 'source')).toEqual({});
    expect(wire.request.mock.calls).toEqual([
      [
        'presence.focus.subscribe',
        expect.objectContaining({ workspaceId: 'source', principalId: 'person' }),
      ],
    ]);
  });
  it('bounds observation to the three rendered people regardless of workspace count', async () => {
    start('owner', ['one', 'two', 'three', 'four']);
    await settle();
    expect(
      wire.request.mock.calls
        .filter(([method]) => method === 'presence.focus.subscribe')
        .map(([, p]) => p.principalId),
    ).toEqual(['one', 'two', 'three']);
  });
  it('rejects a route projection owned by a different request', async () => {
    let finish!: () => void;
    wire.goto.mockImplementation(async () => {
      store.dispatch(openWorkspaceTab('closed', 'another-request'));
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    start();
    await settle();
    click();
    await settle();
    expect(store.state.presenceFollow.navigation).toBeNull();
    finish();
    await settle();
    expect(views()).toEqual([]);
  });
  it.each(['before', 'after'] as const)(
    'retires a manual destination selection %s the owned route projection',
    async (when) => {
      let finish!: () => void;
      wire.goto.mockImplementation(async (_path: string, options: { state: App.PageState }) => {
        if (when === 'after')
          store.dispatch(openWorkspaceTab('closed', options.state.presenceFollowRequestId));
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
      start();
      await settle();
      click();
      await settle();
      store.dispatch(openWorkspaceTab('closed'));
      await settle();
      expect(store.state.presenceFollow.navigation).toBeNull();
      // Late/repeated projections from this history entry cannot revive the click.
      store.dispatch(openWorkspaceTab('closed', 'click-1'));
      store.dispatch(openWorkspaceTab('closed', 'click-1'));
      finish();
      await settle();
      expect(store.state.presenceFollow.navigation).toBeNull();
      expect(views()).toEqual([]);
      expect(wire.goto).toHaveBeenCalledTimes(1);
      expect(store.state.tabState.currentTabId).toBe('closed');
    },
  );
  it.each(['initial freshness', 'layout', 'route', 'final freshness'] as const)(
    'yields to a manual workspace choice during %s',
    async (stage) => {
      let finish!: () => void;
      if (stage === 'layout') {
        wire.hydrate.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
      } else if (stage === 'route') {
        wire.goto.mockImplementation(async (_path: string, options: { state: App.PageState }) => {
          store.dispatch(openWorkspaceTab('closed', options.state.presenceFollowRequestId));
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        });
      } else {
        const request = wire.request.getMockImplementation()!;
        wire.request.mockImplementation(async (...args) => {
          if (
            args[0] === 'presence.focus.subscribe' &&
            serial === (stage === 'initial freshness' ? 1 : 2)
          )
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          return request(...args);
        });
      }
      start();
      await settle();
      click();
      await settle();
      expect(finish).toBeTypeOf('function');
      store.dispatch(openWorkspaceTab('manual'));
      finish();
      await settle();
      expect(store.state.tabState.currentTabId).toBe('manual');
      expect(wire.goto).toHaveBeenCalledTimes(
        stage === 'layout' || stage === 'initial freshness' ? 0 : 1,
      );
      expect(views()).toEqual([]);
      expect(store.state.presenceFollow.navigation).toBeNull();
    },
  );
  it('does not revive a follow when the viewer leaves and returns during layout loading', async () => {
    let finish!: () => void;
    wire.hydrate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    start();
    await settle();
    click();
    await settle();
    store.dispatch(openWorkspaceTab('manual'));
    store.dispatch(openWorkspaceTab('source'));
    finish();
    await settle();
    expect(wire.goto).not.toHaveBeenCalled();
    expect(views()).toEqual([]);
    expect(store.state.tabState.currentTabId).toBe('source');
    expect(store.state.presenceFollow.navigation).toBeNull();
  });
  it.each(['initial freshness', 'layout', 'route', 'final freshness'] as const)(
    'preserves a manual note choice during %s',
    async (stage) => {
      let finish!: () => void;
      if (stage === 'layout') {
        wire.hydrate.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );
      } else if (stage === 'route') {
        wire.goto.mockImplementation(async (_path: string, options: { state: App.PageState }) => {
          store.dispatch(openWorkspaceTab('closed', options.state.presenceFollowRequestId));
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        });
      } else {
        const request = wire.request.getMockImplementation()!;
        wire.request.mockImplementation(async (...args) => {
          if (
            args[0] === 'presence.focus.subscribe' &&
            serial === (stage === 'initial freshness' ? 1 : 2)
          )
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          return request(...args);
        });
      }
      start('guest');
      await settle();
      click();
      await settle();
      const manual = openWorkspaceNote(
        stage === 'layout' || stage === 'initial freshness' ? 'source' : 'closed',
        'manual-note',
      );
      store.dispatch(manual);
      finish();
      await settle();
      expect(views()).toEqual([manual]);
      expect(wire.goto).toHaveBeenCalledTimes(
        stage === 'layout' || stage === 'initial freshness' ? 0 : 1,
      );
      expect(store.state.presenceFollow.navigation).toBeNull();
    },
  );
  it.each([
    ['workspace reselect', () => openWorkspaceTab('source')],
    ['agent', () => openAgentTabRequested('source', { agentId: 'manual-agent' })],
    ['file', () => openWorkspaceFile('source', 'manual.ts')],
    ['panel tab', () => setActiveTab('source', 'manual-tab')],
    ['panel focus', () => focusPanel('source', 'manual-panel')],
    ['next tab', () => selectNextTab('source')],
    ['history', () => goBack('source')],
  ] as const)(
    'retires the pending follow on %s intent even if selection state does not change',
    async (_name, action) => {
      let finish!: () => void;
      wire.hydrate.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      start();
      await settle();
      click();
      await settle();
      store.dispatch(action());
      await settle();
      expect(store.state.presenceFollow.navigation).toBeNull();
      finish();
      await settle();
      expect(wire.goto).not.toHaveBeenCalled();
      expect(views().filter((a) => a.type === openWorkspaceNote.type)).toEqual([]);
    },
  );
  it('aborts when the person moves while the destination layout is loading', async () => {
    let finish!: () => void;
    wire.hydrate.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    start();
    await settle();
    click();
    await settle();
    push(`sub-${serial}`, 1, null);
    finish();
    await settle();
    expect(wire.goto).not.toHaveBeenCalled();
    expect(views()).toEqual([]);
  });
  it('terminal closure during loading clears the action and late frames cannot restore it', async () => {
    let finish!: () => void;
    wire.hydrate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    start('guest');
    await settle();
    click();
    await settle();
    const id = `sub-${serial}`;
    push(id, 1, null, true);
    push(id, 2, { workspaceId: 'closed', noteId: 'spec' });
    finish();
    await settle();
    expect(selectPresenceFollowTargets.select(store.state, 'source')).toEqual({});
    expect(wire.listeners.size).toBe(0);
    expect(wire.goto).not.toHaveBeenCalled();
    expect(views()).toEqual([]);
    expect(store.state.presenceFollow.navigation).toBeNull();
  });
  it('aborts when destination access is removed while the layout is loading', async () => {
    let finish!: () => void;
    wire.hydrate.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    start('guest');
    await settle();
    click();
    await settle();
    store.dispatch(replaceWorkspaceList(workspaces(false)));
    finish();
    await settle();
    expect(wire.goto).not.toHaveBeenCalled();
    expect(views()).toEqual([]);
  });
  it('aborts stale activation if the fresh snapshot reports a different target', async () => {
    start();
    await settle();
    destination = { workspaceId: 'source' };
    click();
    await settle();
    expect(wire.hydrate).not.toHaveBeenCalled();
    expect(wire.goto).not.toHaveBeenCalled();
    expect(views()).toEqual([]);
  });
  it('does not open a stale resource when focus changes during route navigation', async () => {
    let finish!: () => void;
    wire.goto.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    start();
    await settle();
    click();
    await settle();
    push(`sub-${serial}`, 1, null);
    finish();
    await settle();
    expect(views()).toEqual([]);
  });
  it('discards every frame and action on disconnect and rehydrates only after readmission', async () => {
    start();
    await settle();
    const old = `sub-${serial}`;
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    push(old, 1, { workspaceId: 'closed' });
    expect(selectPresenceFollowTargets.select(store.state, 'source')).toEqual({});
    expect(wire.listeners.size).toBe(0);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    await settle();
    expect(selectPresenceFollowTargets.select(store.state, 'source')).toEqual({});
    destination = { workspaceId: 'source', noteId: 'new-note' };
    seedPresence();
    await settle();
    push(old, 2, { workspaceId: 'closed', noteId: 'old-note' });
    click();
    await settle();
    expect(views()).toEqual([
      openWorkspaceNote('source', 'new-note', {
        sourcePanelId: undefined,
        openInAdjacentPanel: false,
      }),
    ]);
  });
  it('clears on backend switch even when the other backend uses identical principal IDs', async () => {
    start();
    await settle();
    const old = `sub-${serial}`;
    const oldGroup = wire.request.mock.calls[0][1].replaceGroup;
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'other', windowBackendId: 'other' }),
    );
    await settle();
    expect(selectPresenceFollowTargets.select(store.state, 'source')).toEqual({});
    destination = { workspaceId: 'source' };
    seedPresence();
    await settle();
    push(old, 1, { workspaceId: 'closed' });
    expect(selectPresenceFollowTargets.select(store.state, 'source').person.target).toEqual(
      destination,
    );
    expect(
      wire.request.mock.calls
        .filter(([method]) => method === 'presence.focus.subscribe')
        .at(-1)?.[1].replaceGroup,
    ).toBe(oldGroup);
  });
  it.each(['gate', 'person', 'membership', 'source'] as const)(
    'clears an active target after %s removal without another destination read',
    async (change) => {
      start('guest');
      await settle();
      const old = `sub-${serial}`;
      if (change === 'gate') store.dispatch(setLabsMultiplayerEnabled(false));
      else if (change === 'person')
        store.dispatch(presenceRosterReceived({ workspaceId: 'source', members: [] }));
      else if (change === 'membership') store.dispatch(presenceMembersReceived('source', []));
      else store.dispatch(replaceWorkspaceList([]));
      await settle();
      push(old, 1, { workspaceId: 'closed' });
      expect(selectPresenceFollowTargets.select(store.state, 'source')).toEqual({});
      expect(wire.listeners.size).toBe(0);
      expect(
        wire.request.mock.calls.filter(([method]) => method === 'presence.focus.subscribe'),
      ).toHaveLength(1);
    },
  );
  it('finishes a rejected click when the cached destination row has disappeared', async () => {
    start();
    await settle();
    const old = selectPresenceFollowTargets.select(store.state, 'source').person;
    store.dispatch(replaceWorkspaceList(workspaces(false)));
    store.dispatch(
      followPresencePersonRequested(old.scope, 'person', old.generation, old.seq, 'stale'),
    );
    await settle();
    expect(store.state.presenceFollow.navigation).toBeNull();
    expect(wire.goto).not.toHaveBeenCalled();
  });
});

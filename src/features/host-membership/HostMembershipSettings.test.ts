/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/svelte';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { withHostPrincipal } from '../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  hostMembershipReducer,
  initialState,
  hostMembershipOpened,
  hostMembershipLoaded,
} from '$store/renderer/slices/host-membership/host-membership-slice';
import {
  principalReducer,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import HostMembershipSettingsHost from './HostMembershipSettingsHost.svelte';
import type { StoreState } from '$store/renderer/types';
const mocks = vi.hoisted(() => ({
  state: {} as StoreState,
  dispatch: vi.fn(),
  request: vi.fn(),
  emit: () => {},
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const mod = createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
  const { select } = await import('typed-redux-saga');
  const createSelector = mod.store.createSelector;
  mod.store.createSelector = (selectorFunc) => {
    const selector = createSelector(selectorFunc);
    selector.effect = function* (...args) {
      return yield* select(selectorFunc, ...args);
    };
    return selector;
  };
  mocks.emit = mod.store.emitState;
  return mod;
});
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { success: vi.fn() } }));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
import HostMembershipSettings from './HostMembershipSettings.svelte';
beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.request.mockReset();
  mocks.state = withHostPrincipal({ hostMembership: initialState });
  mocks.dispatch.mockImplementation((action) => {
    mocks.state = {
      ...mocks.state,
      hostMembership: hostMembershipReducer(mocks.state.hostMembership, action),
      principal: principalReducer(mocks.state.principal, action),
    };
    mocks.emit();
  });
});
afterEach(() => cleanup());
it('renders truthful host scope and submits a confirmed account pin without external profile or repositories', async () => {
  render(HostMembershipSettings, {
    props: { context: selectPrincipalActionContext.select(mocks.state)! },
  });
  expect(screen.queryByRole('button', { name: 'Refresh', exact: true })).toBeNull();
  expect(screen.queryByLabelText('Account username')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
  expect(screen.getByRole('dialog', { name: 'Invite to this instance' })).toBeTruthy();
  expect(
    within(screen.getByTestId('host-membership-settings')).queryByLabelText('Account username'),
  ).toBeNull();
  expect(screen.getByText(/expires after seven days/)).toBeTruthy();
  expect(
    screen.getByText(/Members can create and fully manage all current and future/),
  ).toBeTruthy();
  await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
  await fireEvent.click(screen.getByRole('checkbox'));
  const dialog = screen.getByRole('dialog');
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Create invite link' }));
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'hostMembership/requested',
      payload: [
        expect.any(Object),
        {
          kind: 'create',
          input: { pinLogin: 'sam', pinProvider: 'github', pinHost: 'github.com' },
        },
      ],
    }),
  );
});
it('keeps the owner non-removable and rejects an old removal confirmation after role change', async () => {
  render(HostMembershipSettings, {
    props: { context: selectPrincipalActionContext.select(mocks.state)! },
  });
  const opened = mocks.dispatch.mock.calls.find(
    ([action]) => action.type === hostMembershipOpened.type,
  )![0];
  const target = opened.payload[0];
  const person = {
    principalId: 'owner',
    hostRole: 'owner' as const,
    login: null,
    displayName: 'Owner',
    avatarUrl: null,
    addedAt: '2026-09-30T00:00:00Z',
  };
  mocks.dispatch(
    hostMembershipLoaded(
      target,
      [person, { ...person, principalId: 'member', hostRole: 'member', displayName: 'Sam' }],
      [],
      1,
    ),
  );
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1));
  await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('Sam');
  expect(dialog.textContent).toContain('Guests they already admitted and shared work remain');
  mocks.state = withHostPrincipal(mocks.state, 'member');
  mocks.dispatch.mockClear();
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
  expect(mocks.dispatch).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'hostMembership/requested' }),
  );
});

it('closes the invitation without creating one and returns focus to the invite action', async () => {
  render(HostMembershipSettings, {
    props: { context: selectPrincipalActionContext.select(mocks.state)! },
  });
  const invite = screen.getByRole('button', { name: 'Invite a host member' });
  await fireEvent.click(invite);
  await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
  mocks.dispatch.mockClear();
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Account username')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(invite));
  expect(mocks.dispatch).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'hostMembership/requested' }),
  );
});

it('shows roster profiles and readable providers while preserving exact removal and invite targets', async () => {
  render(HostMembershipSettings, {
    props: { context: selectPrincipalActionContext.select(mocks.state)! },
  });
  const target = mocks.dispatch.mock.calls.find(
    ([action]) => action.type === hostMembershipOpened.type,
  )![0].payload[0];
  const owner = {
    principalId: 'owner-stable',
    hostRole: 'owner' as const,
    login: 'casey',
    displayName: 'Casey Morgan',
    avatarUrl: null,
    addedAt: '2026-09-30T00:00:00Z',
    identity: { provider: 'github' as const, host: 'github.com', externalUserId: '900001' },
  };
  const member = {
    ...owner,
    principalId: 'member-stable',
    hostRole: 'member' as const,
    login: 'sam',
    displayName: 'Sam Rivera',
    identity: {
      provider: 'gitlab' as const,
      host: 'gitlab.team.example',
      externalUserId: '900002',
    },
  };
  const missing = {
    ...owner,
    principalId: 'unknown-stable',
    hostRole: 'member' as const,
    login: null,
    displayName: null,
  };
  const invite = {
    id: 'invite-stable',
    scope: 'host' as const,
    role: 'member' as const,
    createdByPrincipalId: owner.principalId,
    pinLogin: 'alex',
    pinIdentity: member.identity,
    reusable: false as const,
    redemptionCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    expiresAt: '2026-10-08T00:00:00Z',
  };
  mocks.dispatch(hostMembershipLoaded(target, [owner, member, missing], [invite], 1));
  const members = await screen.findByRole('list', { name: 'Host members' });
  await waitFor(() => expect(members.textContent).toContain('Casey Morgan'));
  const rows = within(members).getAllByRole('listitem');
  expect(rows[0].textContent).toContain('Owner');
  expect(rows[0].textContent).toContain('@casey');
  expect(rows[0].textContent).toContain('GitHub');
  expect(rows[1].textContent).toContain('Sam Rivera');
  expect(rows[1].textContent).toContain('@sam');
  expect(rows[1].textContent).toContain('GitLab (gitlab.team.example)');
  expect(rows[2].textContent).toContain('Profile unavailable');
  expect(rows[2].textContent).not.toContain('@casey');
  for (const key of ['github@', 'gitlab@', '900001', '900002', 'unknown-stable'])
    expect(members.textContent).not.toContain(key);
  const invites = screen.getByRole('list', { name: 'Open invites' });
  expect(invites.textContent).toContain('@alex');
  expect(invites.textContent).toContain('GitLab (gitlab.team.example)');
  expect(invites.textContent).not.toContain('900002');
  await fireEvent.click(within(invites).getByRole('button', { name: 'Copy link' }));
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'hostMembership/requested',
      payload: [target, { kind: 'copy', inviteId: 'invite-stable' }],
    }),
  );
  await fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('Sam Rivera');
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'hostMembership/requested',
      payload: [target, { kind: 'remove', principalId: 'member-stable' }],
    }),
  );
});

it.each(['member', 'unknown', 'host', 'withheld'] as const)(
  'cancels the open invitation when authority changes: %s',
  async (change) => {
    render(HostMembershipSettings, {
      props: { context: selectPrincipalActionContext.select(mocks.state)! },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
    await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
    await fireEvent.click(screen.getByRole('checkbox'));
    if (change === 'member') mocks.state = withHostPrincipal(mocks.state, 'member');
    else if (change === 'unknown')
      mocks.state = { ...mocks.state, principal: { ...mocks.state.principal, status: 'loading' } };
    else if (change === 'host')
      mocks.state = {
        ...mocks.state,
        principal: { ...mocks.state.principal, context: 'another-host' },
      };
    else
      mocks.state = {
        ...mocks.state,
        hostMembership: { ...mocks.state.hostMembership, withheld: true },
      };
    mocks.dispatch.mockClear();
    mocks.emit();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hostMembership/requested' }),
    );
  },
);

it('keeps the real refresh failure through copy, close and a fresh draft until lists refresh', async () => {
  const { runSaga, stdChannel } = await import('redux-saga');
  const { hostMembershipSaga } =
    await import('$store/renderer/slices/host-membership/sagas/host-membership-saga');
  const channel = stdChannel();
  const reduce = mocks.dispatch.getMockImplementation()!;
  mocks.dispatch.mockImplementation((action) => {
    reduce(action);
    channel.put(action);
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  let created = false;
  let failRefresh = true;
  const url = 'intent://invite?controlled=created-exact';
  const invite = {
    id: 'created-exact',
    scope: 'host',
    role: 'member',
    createdByPrincipalId: 'owner',
    pinLogin: 'sam',
    pinIdentity: { provider: 'github', host: 'github.com', externalUserId: '2' },
    reusable: false,
    redemptionCount: 0,
    createdAt: '2026-10-02T00:00:00Z',
    expiresAt: '2026-10-09T00:00:00Z',
  };
  mocks.request.mockImplementation(async (method) => {
    if (method === 'host.invite.create') {
      created = true;
      return {
        invite,
        url,
        secret: 'controlled-only',
        hosts: [],
        port: 8080,
        fingerprint: 'test',
        version: 1,
        tcAddress: 'test',
      };
    }
    if (method === 'host.members.list') {
      if (created && failRefresh) throw new Error('refresh failed');
      return { members: [], revision: created ? 2 : 1 };
    }
    if (method === 'host.invite.list') return { invites: created ? [{ ...invite, url }] : [] };
    throw new Error('unexpected method');
  });
  const saga = runSaga(
    { channel, dispatch: mocks.dispatch, getState: () => mocks.state },
    hostMembershipSaga,
  );
  try {
    render(HostMembershipSettings, {
      props: { context: selectPrincipalActionContext.select(mocks.state)! },
    });
    await waitFor(() => expect(mocks.state.hostMembership.loaded).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
    await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(mocks.state.hostMembership.error).toBeTruthy());
    const refreshError = mocks.state.hostMembership.error!;
    expect(screen.queryByRole('button', { name: 'Refresh', exact: true })).toBeNull();
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toBe(refreshError);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(mocks.state.hostMembership.busy).toBe(false));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
    await fireEvent.click(
      within(dialog).getAllByRole('button', { name: 'Close', exact: true }).at(-1)!,
    );
    expect(screen.getByRole('alert').textContent).toBe(refreshError);
    await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
    dialog = screen.getByRole('dialog');
    expect((screen.getByLabelText('Account username') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(within(dialog).getByRole('alert').textContent).toBe(refreshError);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    failRefresh = false;
    const { routeDaemonEventsNotification } =
      await import('$features/events/daemon-events-bridge.client');
    routeDaemonEventsNotification(
      'events.event',
      {
        subscriptionId: 'current',
        event: { type: 'host:invites-changed', data: { inviteId: invite.id, action: 'created' } },
      },
      'current',
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('list', { name: 'Open invites' }).textContent).toContain('@sam');
  } finally {
    cleanup();
    saga.cancel();
    vi.unstubAllGlobals();
  }
});

it('keeps the draft disabled through member revalidation, reloads external changes and recovers on reconnect', async () => {
  const { runSaga, stdChannel } = await import('redux-saga');
  const { hostMembershipSaga } =
    await import('$store/renderer/slices/host-membership/sagas/host-membership-saga');
  const { routeDaemonEventsNotification, DAEMON_EVENTS_SUBSCRIBE_TYPES } =
    await import('$features/events/daemon-events-bridge.client');
  const channel = stdChannel();
  const reduce = mocks.dispatch.getMockImplementation()!;
  mocks.dispatch.mockImplementation((action) => {
    reduce(action);
    channel.put(action);
  });
  let fail = false;
  let members: object[] = [];
  mocks.request.mockImplementation(async (method) => {
    if (method === 'host.invite.create') throw new Error('controlled create rejection');
    if (fail) throw new Error('offline');
    return method === 'host.members.list' ? { members, revision: 2 } : { invites: [] };
  });
  const saga = runSaga(
    { channel, dispatch: mocks.dispatch, getState: () => mocks.state },
    hostMembershipSaga,
  );
  const snapshot = mocks.state.principal.snapshot!;
  const event = (subscriptionId: string, type: string, data: object) =>
    routeDaemonEventsNotification(
      'events.event',
      { subscriptionId, event: { type, data } },
      'current',
    );
  const admit = (role: 'owner' | 'member' = 'owner') =>
    mocks.dispatch(
      principalReceived(
        {
          context: mocks.state.principal.context!,
          invalidation: mocks.state.principal.invalidation,
          presentationVersion: mocks.state.principal.presentationVersion,
        },
        {
          ...snapshot,
          principal: {
            ...snapshot.principal,
            hostMembershipRevision: 2,
            hostRole: role,
            isAdministrator: role === 'owner',
          },
        },
      ),
    );
  try {
    render(HostMembershipSettingsHost);
    await waitFor(() => expect(mocks.state.hostMembership.loaded).toBe(true));
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toContain('host:invites-changed');
    expect(screen.queryByRole('button', { name: 'Refresh', exact: true })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
    await fireEvent.input(screen.getByLabelText('Account username'), {
      target: { value: 'draft' },
    });
    await fireEvent.click(screen.getByRole('checkbox'));
    mocks.request.mockClear();
    event('old-host', 'host:invites-changed', {
      inviteId: 'external',
      action: 'created',
      secret: 'never-dispatch',
    });
    expect(mocks.request).not.toHaveBeenCalled();
    event('current', 'host:members-changed', {
      revision: 2,
      principalId: 'external',
      hostRole: 'member',
      action: 'added',
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create invite link' }).hasAttribute('disabled'),
      ).toBe(true),
    );
    expect((screen.getByLabelText('Account username') as HTMLInputElement).value).toBe('draft');
    members = [
      {
        principalId: 'external',
        hostRole: 'member',
        login: 'new-person',
        displayName: 'New person',
        avatarUrl: null,
        addedAt: '2026-10-02T00:00:00Z',
      },
    ];
    admit();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create invite link' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expect((screen.getByLabelText('Account username') as HTMLInputElement).value).toBe('draft');
    const freshContext = selectPrincipalActionContext.select(mocks.state)!;
    await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(mocks.state.hostMembership.busy).toBe(false));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hostMembership/requested',
        payload: [
          expect.objectContaining({ context: freshContext }),
          {
            kind: 'create',
            input: { pinLogin: 'draft', pinProvider: 'github', pinHost: 'github.com' },
          },
        ],
      }),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('list', { name: 'Host members' }).textContent).toContain('New person');
    fail = true;
    event('current', 'host:invites-changed', {
      inviteId: 'external',
      action: 'revoked',
      secret: 'never-dispatch',
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Refresh', exact: true })).toBeNull();
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain('never-dispatch');
    fail = false;
    members = [];
    mocks.dispatch(backendReconnected());
    await waitFor(() => expect(screen.queryByTestId('host-membership-settings')).toBeNull());
    admit();
    await waitFor(() => expect(mocks.state.hostMembership.loaded).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('New person', { exact: true })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
    admit('member');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('host-membership-settings')).toBeNull();
  } finally {
    cleanup();
    saga.cancel();
  }
});

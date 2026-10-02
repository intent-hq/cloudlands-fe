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
import type { StoreState } from '$store/renderer/types';
const mocks = vi.hoisted(() => ({ state: {} as StoreState, dispatch: vi.fn(), emit: () => {} }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const mod = createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
  mocks.emit = mod.store.emitState;
  return mod;
});
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
import HostMembershipSettings from './HostMembershipSettings.svelte';
beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.state = withHostPrincipal({ hostMembership: initialState });
  mocks.dispatch.mockImplementation((action) => {
    mocks.state = {
      ...mocks.state,
      hostMembership: hostMembershipReducer(mocks.state.hostMembership, action),
    };
    mocks.emit();
  });
});
afterEach(() => cleanup());
it('renders truthful host scope and submits a confirmed account pin without external profile or repositories', async () => {
  render(HostMembershipSettings, {
    props: { context: selectPrincipalActionContext.select(mocks.state)! },
  });
  expect(screen.queryByLabelText('Account username')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Invite a host member' }));
  expect(screen.getByText(/expires after seven days/)).toBeTruthy();
  expect(
    screen.getByText(/Members can create and fully manage all current and future/),
  ).toBeTruthy();
  await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('@sam · GitHub');
  expect(dialog.textContent).not.toContain('github@github.com');
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
  expect(document.activeElement).toBe(invite);
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

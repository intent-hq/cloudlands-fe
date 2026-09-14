/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { Workspace } from '$shared/types';
import {
  HostedRosterOperationError,
  type HostedRoster,
  type WorkspaceMember,
} from '$store/renderer/slices/guest-sessions/guest-sessions-types';

const mocks = vi.hoisted(() => ({
  loaded: true,
  // eslint-disable-next-line themis/collection-state-shape -- test-only selector fixture, not Redux state
  sessions: [] as GuestSessionRecord[],
  openIds: [] as string[],
  connectedIds: [] as string[],
  // eslint-disable-next-line themis/collection-state-shape -- test-only selector fixture, not Redux state
  hosted: [] as Workspace[],
  rosters: {} as Record<string, HostedRoster>,
  removingIds: {} as Record<string, string[]>,
  clearingIds: [] as string[],
  collaboratorOnly: false,
  dispatch: vi.fn(),
  leave: vi.fn(),
  leaveWorkspace: vi.fn(),
  open: vi.fn(),
  loadRoster: vi.fn(),
  removeMember: vi.fn(),
  removeAll: vi.fn(),
  readable: <T>(get: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(get());
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-selectors', () => ({
  selectGuestSessions: () => mocks.readable(() => mocks.sessions),
  selectGuestSessionsOpenIds: () => mocks.readable(() => mocks.openIds),
  selectGuestSessionsConnectedIds: () => mocks.readable(() => mocks.connectedIds),
  selectGuestSessionsLoaded: () => mocks.readable(() => mocks.loaded),
  selectHostedWorkspaces: () => mocks.readable(() => mocks.hosted),
  selectHostedRoster: (workspaceId: string) =>
    mocks.readable(() => mocks.rosters[workspaceId] ?? { status: 'loading', members: [] }),
  selectHostedRemovingPrincipalIds: (workspaceId: string) =>
    mocks.readable(() => mocks.removingIds[workspaceId] ?? []),
  selectIsHostedWorkspaceClearing: (workspaceId: string) =>
    mocks.readable(() => mocks.clearingIds.includes(workspaceId)),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectIsCollaboratorOnlyClient: () => mocks.readable(() => mocks.collaboratorOnly),
}));

vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-slice', () => ({
  leaveGuestSessionRequested: (id: string) => mocks.leave(id),
  leaveGuestWorkspaceRequested: (id: string, workspaceId: string) =>
    mocks.leaveWorkspace(id, workspaceId),
  loadHostedRosterRequested: (workspaceId: string) => mocks.loadRoster(workspaceId),
  removeHostedMemberRequested: (workspaceId: string, principalId: string) =>
    mocks.removeMember(workspaceId, principalId),
  removeAllHostedGuestsRequested: (workspaceId: string) => mocks.removeAll(workspaceId),
}));

vi.mock('$store/renderer/slices/connections/connections-slice', () => ({
  openConnectionRequested: (id: string) => mocks.open(id),
}));

import GuestSessionsSettings from './GuestSessionsSettings.svelte';

const guest: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.9',
  hosts: ['10.0.0.9'],
  port: 4180,
  fingerprint: 'CC:DD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'p-guest',
  login: 'octocat',
  tokenEncrypted: true,
  workspaces: [
    { id: 'ws-a', title: 'Design system' },
    { id: 'ws-b', title: 'Release notes' },
  ],
  updatedAt: 1,
};

const hostedWorkspace = {
  id: 'ws-1',
  title: 'Shared project',
  myRole: 'owner',
  memberCount: 2,
} as unknown as Workspace;

const owner: WorkspaceMember = {
  principalId: 'p-owner',
  login: 'host',
  displayName: 'Host Person',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00.000Z',
};
const collaborator: WorkspaceMember = {
  principalId: 'p-collab',
  login: 'guestlogin',
  displayName: null,
  avatarUrl: null,
  role: 'collaborator',
  addedAt: '2026-09-02T00:00:00.000Z',
};

function resolvedAction(type: string, payload: unknown[], result: unknown = undefined) {
  return { type, payload, promise: Promise.resolve(result) };
}

describe('GuestSessionsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loaded = true;
    mocks.sessions = [];
    mocks.openIds = [];
    mocks.connectedIds = [];
    mocks.hosted = [];
    mocks.rosters = {};
    mocks.removingIds = {};
    mocks.clearingIds = [];
    mocks.collaboratorOnly = false;
    mocks.leave.mockImplementation((id) =>
      resolvedAction('guestSessions/leaveRequested', [id], { left: true, revoked: true }),
    );
    mocks.leaveWorkspace.mockImplementation((id, workspaceId) =>
      resolvedAction('guestSessions/leaveGuestWorkspaceRequested', [id, workspaceId], {
        left: true,
      }),
    );
    mocks.removeAll.mockImplementation((workspaceId) =>
      resolvedAction('guestSessions/removeAllHostedGuestsRequested', [workspaceId], {
        removedPrincipalIds: ['p-collab'],
        failedMembers: [],
        revokedInviteIds: [],
        failedInvites: [],
        invitesUnavailable: null,
      }),
    );
    mocks.open.mockImplementation((id) =>
      resolvedAction('connections/openRequested', [id], { status: 'opened', id }),
    );
    mocks.loadRoster.mockImplementation((workspaceId) =>
      resolvedAction('guestSessions/loadHostedRosterRequested', [workspaceId], []),
    );
    mocks.removeMember.mockImplementation((workspaceId, principalId) =>
      resolvedAction('guestSessions/removeHostedMemberRequested', [workspaceId, principalId], {
        removed: true,
      }),
    );
  });

  afterEach(cleanup);

  it('shows a loading status until main has answered the first list', () => {
    mocks.loaded = false;
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    expect(within(joined).getByRole('status')).toBeTruthy();
    expect(within(joined).queryByRole('list')).toBeNull();
  });

  it('renders both empty states for an owner with nothing shared or joined', () => {
    render(GuestSessionsSettings);
    expect(screen.getByTestId('guest-sessions-hosting')).toBeTruthy();
    expect(screen.queryByTestId('hosted-workspace-roster')).toBeNull();
    const joined = screen.getByTestId('guest-sessions-joined');
    expect(within(joined).queryByRole('list')).toBeNull();
    expect(within(joined).queryByRole('status')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('never shows the owner-side hosting section to a collaborator-only client', () => {
    mocks.collaboratorOnly = true;
    mocks.hosted = [hostedWorkspace];
    render(GuestSessionsSettings);
    expect(screen.queryByTestId('guest-sessions-hosting')).toBeNull();
    expect(mocks.loadRoster).not.toHaveBeenCalled();
  });

  it('lists joined hosts with their pooled connection state', () => {
    mocks.sessions = [guest, { ...guest, id: 'guest-2', label: 'desk.local' }];
    mocks.openIds = ['guest-1', 'guest-2'];
    mocks.connectedIds = ['guest-2'];
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    const rows = Array.from(joined.querySelectorAll('[data-session-id]'));
    expect(rows).toHaveLength(2);
    expect(
      rows[0].querySelector('[data-guest-connected]')?.getAttribute('data-guest-connected'),
    ).toBe('false');
    expect(
      rows[1].querySelector('[data-guest-connected]')?.getAttribute('data-guest-connected'),
    ).toBe('true');
  });

  it('nests the joined workspaces under their host, each with its own Leave', () => {
    mocks.sessions = [guest, { ...guest, id: 'guest-2', label: 'desk.local', workspaces: [] }];
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    const [first, second] = Array.from(joined.querySelectorAll('[data-session-id]'));
    const nested = within(first as HTMLElement).getByTestId('guest-session-workspaces');
    const rows = within(nested).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-workspace-id'))).toEqual(['ws-a', 'ws-b']);
    expect(within(nested).getAllByRole('button', { name: 'Leave' })).toHaveLength(2);
    expect(within(second as HTMLElement).queryByTestId('guest-session-workspaces')).toBeNull();
    expect(within(second as HTMLElement).queryByRole('button', { name: 'Leave' })).toBeNull();
  });

  it('confirms before leaving one workspace and dispatches workspace.members.leave for it only', async () => {
    mocks.sessions = [guest];
    render(GuestSessionsSettings);
    const row = screen
      .getByTestId('guest-sessions-joined')
      .querySelector('[data-workspace-id="ws-b"]')!;

    await fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Leave' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.leaveWorkspace).not.toHaveBeenCalled();
    expect(mocks.leave).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole('button', { name: 'Leave' });
    await fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(mocks.leaveWorkspace).toHaveBeenCalledWith('guest-1', 'ws-b');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'guestSessions/leaveGuestWorkspaceRequested',
        payload: ['guest-1', 'ws-b'],
      }),
    );
    expect(mocks.leave).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('guest-leave-workspace-error')).toBeNull());
  });

  it('keeps a retry after a per-workspace leave fails', async () => {
    mocks.sessions = [guest];
    mocks.leaveWorkspace.mockImplementationOnce((id, workspaceId) => ({
      type: 'guestSessions/leaveGuestWorkspaceRequested',
      payload: [id, workspaceId],
      promise: Promise.reject(new Error('daemon')),
    }));
    render(GuestSessionsSettings);
    const row = screen
      .getByTestId('guest-sessions-joined')
      .querySelector('[data-workspace-id="ws-a"]')!;

    await fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Leave' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Leave' });
    await fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    const alert = await screen.findByTestId('guest-leave-workspace-error');
    expect(alert.textContent).toContain('Design system');
    await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.leaveWorkspace).toHaveBeenCalledTimes(2));
    expect(mocks.leaveWorkspace).toHaveBeenLastCalledWith('guest-1', 'ws-a');
    await waitFor(() => expect(screen.queryByTestId('guest-leave-workspace-error')).toBeNull());
  });

  it('shows no connection status for a joined host that has no window open', () => {
    mocks.sessions = [guest];
    mocks.openIds = [];
    // A stale pooled-connection id must not be mistaken for an open window.
    mocks.connectedIds = ['guest-1'];
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    const [row] = within(joined).getAllByRole('listitem');
    expect(row.querySelector('[data-guest-connected]')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Leave host' })).toBeTruthy();
  });

  it('opens a joined host through connections/openRequested', async () => {
    mocks.sessions = [guest];
    render(GuestSessionsSettings);
    const row = screen
      .getByTestId('guest-sessions-joined')
      .querySelector('[data-session-id="guest-1"]')!;
    await fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Open' }));
    expect(mocks.open).toHaveBeenCalledWith('guest-1');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'connections/openRequested', payload: ['guest-1'] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('guest-sessions-open-error')).toBeNull();
  });

  it('surfaces an unavailable stored guest token (a resolved secret-unavailable open) as an error', async () => {
    mocks.sessions = [guest];
    mocks.open.mockImplementationOnce((id) =>
      resolvedAction('connections/openRequested', [id], { status: 'secret-unavailable' }),
    );
    render(GuestSessionsSettings);
    const row = screen
      .getByTestId('guest-sessions-joined')
      .querySelector('[data-session-id="guest-1"]')!;
    await fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Open' }));
    const alert = await screen.findByTestId('guest-sessions-open-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('studio.local');
  });

  it('surfaces a rejected open as an error', async () => {
    mocks.sessions = [guest];
    mocks.open.mockImplementationOnce((id) => ({
      type: 'connections/openRequested',
      payload: [id],
      promise: Promise.reject(new Error('ipc failed')),
    }));
    render(GuestSessionsSettings);
    const row = screen
      .getByTestId('guest-sessions-joined')
      .querySelector('[data-session-id="guest-1"]')!;
    await fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Open' }));
    expect((await screen.findByTestId('guest-sessions-open-error')).textContent).toContain(
      'studio.local',
    );
  });

  it('requires confirmation before leaving a host and keeps a retry after failure', async () => {
    mocks.sessions = [guest];
    mocks.leave.mockImplementationOnce((id) => ({
      type: 'guestSessions/leaveRequested',
      payload: [id],
      promise: Promise.reject(new Error('ipc failed')),
    }));
    render(GuestSessionsSettings);

    await fireEvent.click(screen.getByRole('button', { name: 'Leave host' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.leave).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole('button', { name: 'Leave host' });
    await fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(mocks.leave).toHaveBeenCalledWith('guest-1');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'guestSessions/leaveRequested', payload: ['guest-1'] }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('studio.local');

    await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  describe('hosted roster', () => {
    beforeEach(() => {
      mocks.hosted = [hostedWorkspace];
    });

    it('requests the roster on mount and shows a loading status until it arrives', () => {
      render(GuestSessionsSettings);
      expect(mocks.loadRoster).toHaveBeenCalledWith('ws-1');
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'guestSessions/loadHostedRosterRequested',
          payload: ['ws-1'],
        }),
      );
      const roster = screen.getByTestId('hosted-workspace-roster');
      expect(within(roster).getByRole('status')).toBeTruthy();
    });

    it('surfaces a roster load failure as an alert', () => {
      mocks.rosters = { 'ws-1': { status: 'error', members: [] } };
      render(GuestSessionsSettings);
      expect(within(screen.getByTestId('hosted-workspace-roster')).getByRole('alert')).toBeTruthy();
    });

    it('renders a withheld roster with no member rows, no Remove, and no alert', () => {
      mocks.rosters = { 'ws-1': { status: 'withheld', members: [] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      expect(within(roster).getByTestId('hosted-roster-withheld')).toBeTruthy();
      expect(within(roster).queryByRole('list')).toBeNull();
      expect(within(roster).queryByRole('button', { name: 'Remove' })).toBeNull();
      expect(within(roster).queryByRole('alert')).toBeNull();
    });

    it('lists members and offers Remove only for collaborators', () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      const rows = within(roster).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).queryByRole('button', { name: 'Remove' })).toBeNull();
      expect(within(rows[1]).getByRole('button', { name: 'Remove' })).toBeTruthy();
    });

    it('disables Remove while a removal for that member is in flight', () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removingIds = { 'ws-1': ['p-collab'] };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      expect(
        (within(roster).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('confirms before removing a collaborator and dispatches workspace.members.remove', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByRole('button', { name: 'Remove' }));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mocks.removeMember).not.toHaveBeenCalled();

      const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
      await fireEvent.click(removeButtons[removeButtons.length - 1]);
      expect(mocks.removeMember).toHaveBeenCalledWith('ws-1', 'p-collab');
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'guestSessions/removeHostedMemberRequested',
          payload: ['ws-1', 'p-collab'],
        }),
      );
    });

    it('offers no retry once a forbidden removal has withheld the roster', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removeMember.mockImplementationOnce((workspaceId, principalId) => ({
        type: 'guestSessions/removeHostedMemberRequested',
        payload: [workspaceId, principalId],
        promise: Promise.reject(new HostedRosterOperationError('forbidden')),
      }));
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByRole('button', { name: 'Remove' }));
      const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
      await fireEvent.click(removeButtons[removeButtons.length - 1]);
      await waitFor(() => expect(mocks.removeMember).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(within(roster).queryByRole('alert')).toBeNull();
    });

    it('keeps a retry action when the removal fails', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removeMember.mockImplementationOnce((workspaceId, principalId) => ({
        type: 'guestSessions/removeHostedMemberRequested',
        payload: [workspaceId, principalId],
        promise: Promise.reject(new HostedRosterOperationError('transport')),
      }));
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByRole('button', { name: 'Remove' }));
      const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
      await fireEvent.click(removeButtons[removeButtons.length - 1]);

      const alert = await within(roster).findByRole('alert');
      expect(alert.textContent).toContain('guestlogin');
      await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeMember).toHaveBeenCalledTimes(2));
    });

    it('hides Remove all guests on a withheld roster', () => {
      mocks.rosters = { 'ws-1': { status: 'withheld', members: [] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      expect(within(roster).queryByTestId('hosted-roster-remove-all')).toBeNull();
    });

    it('confirms before Remove all guests and dispatches the sweep for that workspace', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByTestId('hosted-roster-remove-all'));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mocks.removeAll).not.toHaveBeenCalled();

      const confirmButtons = screen.getAllByRole('button', { name: 'Remove all guests' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);
      expect(mocks.removeAll).toHaveBeenCalledWith('ws-1');
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'guestSessions/removeAllHostedGuestsRequested',
          payload: ['ws-1'],
        }),
      );
      expect(mocks.removeMember).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(within(roster).queryByTestId('hosted-roster-remove-all-error')).toBeNull(),
      );
    });

    it('disables Remove all guests while the sweep is in flight', () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.clearingIds = ['ws-1'];
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      expect(
        (within(roster).getByTestId('hosted-roster-remove-all') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it('reports every step of a partially failed sweep and offers a retry', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removeAll.mockImplementationOnce((workspaceId) =>
        resolvedAction('guestSessions/removeAllHostedGuestsRequested', [workspaceId], {
          removedPrincipalIds: [],
          failedMembers: [{ principalId: 'p-collab', code: 'daemon' }],
          revokedInviteIds: ['inv-ok'],
          failedInvites: [
            { inviteId: 'inv-1', pinLogin: 'pinned-user', code: 'daemon' },
            { inviteId: 'inv-2', pinLogin: null, code: 'transport' },
          ],
          invitesUnavailable: null,
        }),
      );
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByTestId('hosted-roster-remove-all'));
      const confirmButtons = screen.getAllByRole('button', { name: 'Remove all guests' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);

      const report = await within(roster).findByTestId('hosted-roster-remove-all-error');
      const lines = within(report).getAllByRole('listitem');
      expect(lines).toHaveLength(3);
      expect(lines[0].textContent).toContain('guestlogin');
      expect(lines[1].textContent).toContain('@pinned-user');
      expect(lines[2].textContent).not.toContain('inv-2');

      await fireEvent.click(within(report).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeAll).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(within(roster).queryByTestId('hosted-roster-remove-all-error')).toBeNull(),
      );
    });

    it('reports that no invite was revoked when the invite list itself failed', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removeAll.mockImplementationOnce((workspaceId) =>
        resolvedAction('guestSessions/removeAllHostedGuestsRequested', [workspaceId], {
          removedPrincipalIds: ['p-collab'],
          failedMembers: [],
          revokedInviteIds: [],
          failedInvites: [],
          invitesUnavailable: 'transport',
        }),
      );
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByTestId('hosted-roster-remove-all'));
      const confirmButtons = screen.getAllByRole('button', { name: 'Remove all guests' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);

      const report = await within(roster).findByTestId('hosted-roster-remove-all-error');
      expect(within(report).getAllByRole('listitem')).toHaveLength(1);
    });

    it('surfaces a sweep that could not run at all with a retry', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removeAll.mockImplementationOnce((workspaceId) => ({
        type: 'guestSessions/removeAllHostedGuestsRequested',
        payload: [workspaceId],
        promise: Promise.reject(new Error('forbidden')),
      }));
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByTestId('hosted-roster-remove-all'));
      const confirmButtons = screen.getAllByRole('button', { name: 'Remove all guests' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);

      const report = await within(roster).findByTestId('hosted-roster-remove-all-error');
      expect(report.textContent).toContain('Shared project');
      await fireEvent.click(within(report).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeAll).toHaveBeenCalledTimes(2));
    });
  });
});

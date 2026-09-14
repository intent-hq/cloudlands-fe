/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { Workspace } from '$shared/types';
import type {
  HostedRoster,
  WorkspaceMember,
} from '$store/renderer/slices/guest-sessions/guest-sessions-types';

const mocks = vi.hoisted(() => ({
  loaded: true,
  sessions: [] as GuestSessionRecord[],
  connectedIds: [] as string[],
  hosted: [] as Workspace[],
  rosters: {} as Record<string, HostedRoster>,
  removingIds: {} as Record<string, string[]>,
  collaboratorOnly: false,
  dispatch: vi.fn(),
  leave: vi.fn(),
  open: vi.fn(),
  loadRoster: vi.fn(),
  removeMember: vi.fn(),
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
  selectGuestSessionsConnectedIds: () => mocks.readable(() => mocks.connectedIds),
  selectGuestSessionsLoaded: () => mocks.readable(() => mocks.loaded),
  selectHostedWorkspaces: () => mocks.readable(() => mocks.hosted),
  selectHostedRoster: (workspaceId: string) =>
    mocks.readable(() => mocks.rosters[workspaceId] ?? { status: 'loading', members: [] }),
  selectHostedRemovingPrincipalIds: (workspaceId: string) =>
    mocks.readable(() => mocks.removingIds[workspaceId] ?? []),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectIsCollaboratorOnlyClient: () => mocks.readable(() => mocks.collaboratorOnly),
}));

vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-slice', () => ({
  leaveGuestSessionRequested: (id: string) => mocks.leave(id),
  loadHostedRosterRequested: (workspaceId: string) => mocks.loadRoster(workspaceId),
  removeHostedMemberRequested: (workspaceId: string, principalId: string) =>
    mocks.removeMember(workspaceId, principalId),
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
    mocks.connectedIds = [];
    mocks.hosted = [];
    mocks.rosters = {};
    mocks.removingIds = {};
    mocks.collaboratorOnly = false;
    mocks.leave.mockImplementation((id) =>
      resolvedAction('guestSessions/leaveRequested', [id], { left: true, revoked: true }),
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
    mocks.connectedIds = ['guest-2'];
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    const rows = within(joined).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(
      rows[0].querySelector('[data-guest-connected]')?.getAttribute('data-guest-connected'),
    ).toBe('false');
    expect(
      rows[1].querySelector('[data-guest-connected]')?.getAttribute('data-guest-connected'),
    ).toBe('true');
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

    it('keeps a retry action when the removal fails', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      mocks.removeMember.mockImplementationOnce((workspaceId, principalId) => ({
        type: 'guestSessions/removeHostedMemberRequested',
        payload: [workspaceId, principalId],
        promise: Promise.reject(new Error('forbidden')),
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
  });
});

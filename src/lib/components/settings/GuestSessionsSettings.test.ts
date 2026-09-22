/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { Workspace } from '$shared/types';
import { TC_ADDRESS } from '../../../test/fixtures/tc-address.fixture';
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
  subscribers: new Set<() => void>(),
  readable: <T>(get: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(get());
      const notify = () => run(get());
      mocks.subscribers.add(notify);
      return () => {
        mocks.subscribers.delete(notify);
      };
    },
  }),
  /** Re-read every mocked selector, as a store change would. */
  publish() {
    for (const notify of mocks.subscribers) notify();
  },
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

/** An action whose promise the test settles by hand. */
function pendingAction(type: string, payload: unknown[]) {
  let resolve!: (result: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { action: { type, payload, promise }, resolve, reject };
}

const sweepClean = {
  removedPrincipalIds: ['p-collab'],
  failedMembers: [],
  revokedInviteIds: [],
  failedInvites: [],
  invitesUnavailable: null,
};

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
      resolvedAction('guestSessions/removeAllHostedGuestsRequested', [workspaceId], sweepClean),
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

  afterEach(() => {
    cleanup();
    mocks.subscribers.clear();
  });

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

  it('labels a joined host by its captured hostname and keeps the dialled address as secondary text', () => {
    mocks.sessions = [
      { ...guest, label: 'tc.example.ts.net', hostname: 'Clement’s Mac Studio' },
      { ...guest, id: 'guest-2', label: 'tc2.example.ts.net', hostname: null },
    ];
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    const captured = joined.querySelector('[data-session-id="guest-1"]') as HTMLElement;
    const pending = joined.querySelector('[data-session-id="guest-2"]') as HTMLElement;

    // Hostname captured: it is the primary label; the address moves to the
    // secondary line rather than disappearing.
    expect(within(captured).getByText('Clement’s Mac Studio')).toBeTruthy();
    expect(captured.querySelector('[data-guest-address]')?.textContent).toBe('tc.example.ts.net');
    expect(within(captured).getByRole('list', { name: /Clement’s Mac Studio/ })).toBeTruthy();
    // Not yet captured: the address stays the primary label, with nothing to repeat.
    expect(within(pending).getByText('tc2.example.ts.net')).toBeTruthy();
    expect(pending.querySelector('[data-guest-address]')).toBeNull();
  });

  it('never shows an opaque tc address: "Unknown host" until the hostname arrives, then the hostname alone', () => {
    mocks.sessions = [
      { ...guest, label: TC_ADDRESS, tcAddress: TC_ADDRESS, hostname: null },
      {
        ...guest,
        id: 'guest-2',
        label: TC_ADDRESS,
        tcAddress: TC_ADDRESS,
        hostname: 'Clement’s Mac Studio',
      },
      { ...guest, id: 'guest-3', label: '10.0.0.9', hostname: null },
    ];
    render(GuestSessionsSettings);
    const joined = screen.getByTestId('guest-sessions-joined');
    const pending = joined.querySelector('[data-session-id="guest-1"]') as HTMLElement;
    const captured = joined.querySelector('[data-session-id="guest-2"]') as HTMLElement;
    const ip = joined.querySelector('[data-session-id="guest-3"]') as HTMLElement;

    expect(within(pending).getByText('Unknown host')).toBeTruthy();
    expect(pending.querySelector('[data-guest-address]')).toBeNull();
    expect(within(captured).getByText('Clement’s Mac Studio')).toBeTruthy();
    expect(captured.querySelector('[data-guest-address]')).toBeNull();
    expect(joined.textContent).not.toContain(TC_ADDRESS);
    // A plain IP is still a readable address and stays the primary label.
    expect(within(ip).getByText('10.0.0.9')).toBeTruthy();
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

  describe('a joined workspace the host projects with an empty title', () => {
    const untitled = { ...guest, workspaces: [{ id: 'ws-untitled', title: '' }] };

    function untitledRow(): HTMLElement {
      return screen
        .getByTestId('guest-sessions-joined')
        .querySelector('[data-workspace-id="ws-untitled"]') as HTMLElement;
    }

    it('shows the Untitled fallback in its row', () => {
      mocks.sessions = [untitled];
      render(GuestSessionsSettings);
      expect(within(untitledRow()).getByText('Untitled')).toBeTruthy();
    });

    it('names it Untitled in the Leave confirm dialog', async () => {
      mocks.sessions = [untitled];
      render(GuestSessionsSettings);
      await fireEvent.click(within(untitledRow()).getByRole('button', { name: 'Leave' }));
      expect(screen.getByRole('dialog').textContent).toContain('Untitled');
    });

    it('names it Untitled when the leave fails', async () => {
      mocks.sessions = [untitled];
      mocks.leaveWorkspace.mockImplementationOnce((id, workspaceId) => ({
        type: 'guestSessions/leaveGuestWorkspaceRequested',
        payload: [id, workspaceId],
        promise: Promise.reject(new Error('daemon')),
      }));
      render(GuestSessionsSettings);
      await fireEvent.click(within(untitledRow()).getByRole('button', { name: 'Leave' }));
      const confirmButtons = screen.getAllByRole('button', { name: 'Leave' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);

      const alert = await screen.findByTestId('guest-leave-workspace-error');
      expect(alert.textContent).toContain('Untitled');
      expect(mocks.leaveWorkspace).toHaveBeenCalledWith('guest-1', 'ws-untitled');
    });
  });

  /**
   * A confirmed operation A is pending; the user opens the same dialog for B
   * and CANCELS it; then A fails. The retry must re-run A — B was never
   * confirmed, so nothing may ever leave B — and A's late settlement must not
   * close the dialog the user is looking at.
   */
  describe('retry binds to the confirmed operation, never to the dialog target', () => {
    async function confirmDialog(name: string) {
      await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    async function cancelDialog() {
      await fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    it('per-workspace Leave: retry leaves A again, never the cancelled B', async () => {
      mocks.sessions = [guest];
      const leaveA = pendingAction('guestSessions/leaveGuestWorkspaceRequested', [
        'guest-1',
        'ws-a',
      ]);
      mocks.leaveWorkspace.mockImplementationOnce(() => leaveA.action);
      render(GuestSessionsSettings);
      const joined = screen.getByTestId('guest-sessions-joined');
      const rowA = joined.querySelector('[data-workspace-id="ws-a"]') as HTMLElement;
      const rowB = joined.querySelector('[data-workspace-id="ws-b"]') as HTMLElement;

      await fireEvent.click(within(rowA).getByRole('button', { name: 'Leave' }));
      await confirmDialog('Leave');
      expect(mocks.leaveWorkspace).toHaveBeenCalledWith('guest-1', 'ws-a');

      await fireEvent.click(within(rowB).getByRole('button', { name: 'Leave' }));
      expect(screen.getByRole('dialog').textContent).toContain('Release notes');
      await cancelDialog();

      leaveA.reject(new Error('transport'));
      const alert = await screen.findByTestId('guest-leave-workspace-error');
      expect(alert.textContent).toContain('Design system');
      await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.leaveWorkspace).toHaveBeenCalledTimes(2));
      expect(mocks.leaveWorkspace.mock.calls).toEqual([
        ['guest-1', 'ws-a'],
        ['guest-1', 'ws-a'],
      ]);
      await waitFor(() => expect(screen.queryByTestId('guest-leave-workspace-error')).toBeNull());
    });

    it('per-workspace Leave: a late success of A leaves the dialog opened for B alone', async () => {
      mocks.sessions = [guest];
      const leaveA = pendingAction('guestSessions/leaveGuestWorkspaceRequested', [
        'guest-1',
        'ws-a',
      ]);
      mocks.leaveWorkspace.mockImplementationOnce(() => leaveA.action);
      render(GuestSessionsSettings);
      const joined = screen.getByTestId('guest-sessions-joined');
      const rowA = joined.querySelector('[data-workspace-id="ws-a"]') as HTMLElement;
      const rowB = joined.querySelector('[data-workspace-id="ws-b"]') as HTMLElement;

      await fireEvent.click(within(rowA).getByRole('button', { name: 'Leave' }));
      await confirmDialog('Leave');
      await fireEvent.click(within(rowB).getByRole('button', { name: 'Leave' }));

      leaveA.resolve({ left: true });
      await waitFor(() =>
        expect((within(rowA).getByRole('button') as HTMLButtonElement).disabled).toBe(false),
      );
      expect(screen.getByRole('dialog').textContent).toContain('Release notes');
      await confirmDialog('Leave');
      expect(mocks.leaveWorkspace).toHaveBeenLastCalledWith('guest-1', 'ws-b');
    });

    it('Leave host: retry leaves A again, never the cancelled B', async () => {
      const second: GuestSessionRecord = {
        ...guest,
        id: 'guest-2',
        label: 'second.local',
        hostname: 'second.local',
      };
      mocks.sessions = [guest, second];
      const leaveA = pendingAction('guestSessions/leaveRequested', ['guest-1']);
      mocks.leave.mockImplementationOnce(() => leaveA.action);
      render(GuestSessionsSettings);
      const joined = screen.getByTestId('guest-sessions-joined');
      const rowA = joined.querySelector('[data-session-id="guest-1"]') as HTMLElement;
      const rowB = joined.querySelector('[data-session-id="guest-2"]') as HTMLElement;

      await fireEvent.click(within(rowA).getByRole('button', { name: 'Leave host' }));
      await confirmDialog('Leave host');
      expect(mocks.leave).toHaveBeenCalledWith('guest-1');

      await fireEvent.click(within(rowB).getByRole('button', { name: 'Leave host' }));
      expect(screen.getByRole('dialog').textContent).toContain('second.local');
      await cancelDialog();

      leaveA.reject(new Error('transport'));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('studio.local');
      await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(2));
      expect(mocks.leave.mock.calls).toEqual([['guest-1'], ['guest-1']]);
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
  });

  /**
   * Leaves of different targets are independent operations: confirming B
   * while A is still pending must dispatch B (not be silently dropped by a
   * guard scoped to A), and when both fail each keeps its own retry.
   */
  describe('concurrent leaves are independent', () => {
    async function confirmDialog(name: string) {
      await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }

    it('per-workspace Leave: confirming B while A is pending leaves B too, with one retry each', async () => {
      mocks.sessions = [guest];
      const leaveA = pendingAction('guestSessions/leaveGuestWorkspaceRequested', [
        'guest-1',
        'ws-a',
      ]);
      const leaveB = pendingAction('guestSessions/leaveGuestWorkspaceRequested', [
        'guest-1',
        'ws-b',
      ]);
      mocks.leaveWorkspace
        .mockImplementationOnce(() => leaveA.action)
        .mockImplementationOnce(() => leaveB.action);
      render(GuestSessionsSettings);
      const joined = screen.getByTestId('guest-sessions-joined');
      const rowA = joined.querySelector('[data-workspace-id="ws-a"]') as HTMLElement;
      const rowB = joined.querySelector('[data-workspace-id="ws-b"]') as HTMLElement;

      await fireEvent.click(within(rowA).getByRole('button', { name: 'Leave' }));
      await confirmDialog('Leave');
      await fireEvent.click(within(rowB).getByRole('button', { name: 'Leave' }));
      await confirmDialog('Leave');
      expect(mocks.leaveWorkspace.mock.calls).toEqual([
        ['guest-1', 'ws-a'],
        ['guest-1', 'ws-b'],
      ]);
      expect((within(rowA).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
      expect((within(rowB).getByRole('button') as HTMLButtonElement).disabled).toBe(true);

      leaveA.reject(new Error('transport'));
      leaveB.reject(new Error('transport'));
      await waitFor(() =>
        expect(screen.getAllByTestId('guest-leave-workspace-error')).toHaveLength(2),
      );
      const alerts = screen.getAllByTestId('guest-leave-workspace-error');
      expect(alerts.map((a) => a.textContent)).toEqual([
        expect.stringContaining('Design system'),
        expect.stringContaining('Release notes'),
      ]);

      const alertB = alerts.find((a) => a.getAttribute('data-workspace-id') === 'ws-b')!;
      await fireEvent.click(within(alertB).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.leaveWorkspace).toHaveBeenCalledTimes(3));
      expect(mocks.leaveWorkspace).toHaveBeenLastCalledWith('guest-1', 'ws-b');
      await waitFor(() =>
        expect(screen.getAllByTestId('guest-leave-workspace-error')).toHaveLength(1),
      );
      expect(
        screen.getByTestId('guest-leave-workspace-error').getAttribute('data-workspace-id'),
      ).toBe('ws-a');
    });

    it('Leave host: confirming B while A is pending leaves B too, with one retry each', async () => {
      const second: GuestSessionRecord = { ...guest, id: 'guest-2', label: 'second.local' };
      mocks.sessions = [guest, second];
      const leaveA = pendingAction('guestSessions/leaveRequested', ['guest-1']);
      const leaveB = pendingAction('guestSessions/leaveRequested', ['guest-2']);
      mocks.leave
        .mockImplementationOnce(() => leaveA.action)
        .mockImplementationOnce(() => leaveB.action);
      render(GuestSessionsSettings);
      const joined = screen.getByTestId('guest-sessions-joined');
      const rowA = joined.querySelector('[data-session-id="guest-1"]') as HTMLElement;
      const rowB = joined.querySelector('[data-session-id="guest-2"]') as HTMLElement;

      await fireEvent.click(within(rowA).getByRole('button', { name: 'Leave host' }));
      await confirmDialog('Leave host');
      await fireEvent.click(within(rowB).getByRole('button', { name: 'Leave host' }));
      await confirmDialog('Leave host');
      expect(mocks.leave.mock.calls).toEqual([['guest-1'], ['guest-2']]);

      leaveA.reject(new Error('transport'));
      leaveB.reject(new Error('transport'));
      await waitFor(() => expect(screen.getAllByTestId('guest-leave-error')).toHaveLength(2));
      const alertA = screen
        .getAllByTestId('guest-leave-error')
        .find((a) => a.getAttribute('data-session-id') === 'guest-1')!;
      expect(alertA.textContent).toContain('studio.local');
      await fireEvent.click(within(alertA).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(3));
      expect(mocks.leave).toHaveBeenLastCalledWith('guest-1');
      await waitFor(() => expect(screen.getAllByTestId('guest-leave-error')).toHaveLength(1));
      expect(screen.getByTestId('guest-leave-error').getAttribute('data-session-id')).toBe(
        'guest-2',
      );
    });
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

    it('lists only collaborators, each with Remove, and never the owner', () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      const rows = within(roster).getAllByRole('listitem');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('guestlogin');
      expect(rows[0].textContent).not.toContain('Host Person');
      expect(within(rows[0]).getByRole('button', { name: 'Remove' })).toBeTruthy();
    });

    it('renders no rows when the loaded roster holds only the owner', () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      expect(within(roster).queryAllByRole('listitem')).toHaveLength(0);
      expect(roster.textContent).not.toContain('Host Person');
      expect(within(roster).queryByRole('button', { name: 'Remove' })).toBeNull();
      expect(within(roster).queryByRole('status')).toBeNull();
      expect(within(roster).queryByRole('alert')).toBeNull();
    });

    it('leads each collaborator row with an avatar image or an initial fallback', () => {
      const withAvatar: WorkspaceMember = {
        ...collaborator,
        principalId: 'p-pictured',
        login: 'pictured',
        displayName: 'Pictured Guest',
        avatarUrl: 'https://avatars.example/pictured.png',
      };
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, withAvatar, collaborator] } };
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      const rows = within(roster).getAllByRole('listitem');
      expect(rows).toHaveLength(2);

      const img = within(rows[0]).getByTestId('hosted-roster-avatar') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('https://avatars.example/pictured.png');
      expect(within(rows[0]).queryByTestId('hosted-roster-avatar-fallback')).toBeNull();

      expect(within(rows[1]).queryByTestId('hosted-roster-avatar')).toBeNull();
      expect(within(rows[1]).getByTestId('hosted-roster-avatar-fallback').textContent).toBe('G');
    });

    it('falls back to the initial when the avatar image fails to load', async () => {
      const withAvatar: WorkspaceMember = {
        ...collaborator,
        principalId: 'p-pictured',
        login: 'pictured',
        displayName: 'Pictured Guest',
        avatarUrl: 'https://avatars.example/stale.png',
      };
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, withAvatar] } };
      render(GuestSessionsSettings);
      const [row] = within(screen.getByTestId('hosted-workspace-roster')).getAllByRole('listitem');

      await fireEvent.error(within(row).getByTestId('hosted-roster-avatar'));

      expect(within(row).queryByTestId('hosted-roster-avatar')).toBeNull();
      expect(within(row).getByTestId('hosted-roster-avatar-fallback').textContent).toBe('P');
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

    it('retries the removal that failed, never a later cancelled dialog target', async () => {
      const second: WorkspaceMember = {
        ...collaborator,
        principalId: 'p-other',
        login: 'otherguest',
      };
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator, second] } };
      const removeA = pendingAction('guestSessions/removeHostedMemberRequested', [
        'ws-1',
        'p-collab',
      ]);
      mocks.removeMember.mockImplementationOnce(() => removeA.action);
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');
      const rowButtons = within(roster).getAllByRole('button', { name: 'Remove' });

      await fireEvent.click(rowButtons[0]);
      await fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(mocks.removeMember).toHaveBeenCalledWith('ws-1', 'p-collab');

      await fireEvent.click(rowButtons[1]);
      expect(screen.getByRole('dialog').textContent).toContain('otherguest');
      await fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      removeA.reject(new Error('transport'));
      const alert = await within(roster).findByRole('alert');
      expect(alert.textContent).toContain('guestlogin');
      await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeMember).toHaveBeenCalledTimes(2));
      expect(mocks.removeMember.mock.calls).toEqual([
        ['ws-1', 'p-collab'],
        ['ws-1', 'p-collab'],
      ]);
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
        expect(screen.queryByTestId('hosted-roster-remove-all-error')).toBeNull(),
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

      const report = await screen.findByTestId('hosted-roster-remove-all-error');
      const lines = within(report).getAllByRole('listitem');
      expect(lines).toHaveLength(3);
      expect(lines[0].textContent).toContain('guestlogin');
      expect(lines[1].textContent).toContain('@pinned-user');
      expect(lines[2].textContent).not.toContain('inv-2');

      await fireEvent.click(within(report).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeAll).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByTestId('hosted-roster-remove-all-error')).toBeNull(),
      );
    });

    /**
     * The sweep's own membership delta (or a concurrent role loss) can drop the
     * workspace from *Shared by me* before the sweep settles. The per-step
     * report and its retry must not vanish with the row.
     */
    it('keeps a partial sweep report when its row leaves Shared by me mid-sweep', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      const sweep = pendingAction('guestSessions/removeAllHostedGuestsRequested', ['ws-1']);
      mocks.removeAll.mockImplementationOnce(() => sweep.action);
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByTestId('hosted-roster-remove-all'));
      const confirmButtons = screen.getAllByRole('button', { name: 'Remove all guests' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);
      expect(mocks.removeAll).toHaveBeenCalledWith('ws-1');

      mocks.hosted = [];
      mocks.publish();
      await waitFor(() => expect(screen.queryByTestId('hosted-workspace-roster')).toBeNull());

      sweep.resolve({
        removedPrincipalIds: [],
        failedMembers: [{ principalId: 'p-collab', code: 'daemon' }],
        revokedInviteIds: [],
        failedInvites: [],
        invitesUnavailable: null,
      });
      const report = await screen.findByTestId('hosted-roster-remove-all-error');
      expect(report.getAttribute('data-workspace-id')).toBe('ws-1');
      expect(report.textContent).toContain('Shared project');
      expect(within(report).getAllByRole('listitem')[0].textContent).toContain('guestlogin');

      await fireEvent.click(within(report).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeAll).toHaveBeenCalledTimes(2));
      expect(mocks.removeAll).toHaveBeenLastCalledWith('ws-1');
      await waitFor(() =>
        expect(screen.queryByTestId('hosted-roster-remove-all-error')).toBeNull(),
      );
    });

    it('keeps a sweep that failed outright reportable after its row is gone', async () => {
      mocks.rosters = { 'ws-1': { status: 'loaded', members: [owner, collaborator] } };
      const sweep = pendingAction('guestSessions/removeAllHostedGuestsRequested', ['ws-1']);
      mocks.removeAll.mockImplementationOnce(() => sweep.action);
      render(GuestSessionsSettings);
      const roster = screen.getByTestId('hosted-workspace-roster');

      await fireEvent.click(within(roster).getByTestId('hosted-roster-remove-all'));
      const confirmButtons = screen.getAllByRole('button', { name: 'Remove all guests' });
      await fireEvent.click(confirmButtons[confirmButtons.length - 1]);

      mocks.hosted = [];
      mocks.publish();
      await waitFor(() => expect(screen.queryByTestId('hosted-workspace-roster')).toBeNull());

      sweep.reject(new Error('forbidden'));
      const report = await screen.findByTestId('hosted-roster-remove-all-error');
      expect(report.textContent).toContain('Shared project');
      expect(within(report).queryAllByRole('listitem')).toHaveLength(0);
      expect(
        (within(report).getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled,
      ).toBe(false);
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

      const report = await screen.findByTestId('hosted-roster-remove-all-error');
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

      const report = await screen.findByTestId('hosted-roster-remove-all-error');
      expect(report.textContent).toContain('Shared project');
      await fireEvent.click(within(report).getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.removeAll).toHaveBeenCalledTimes(2));
    });

    it('names an untitled hosted workspace Untitled when its sweep fails', async () => {
      mocks.hosted = [{ ...hostedWorkspace, title: '' } as Workspace];
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

      const report = await screen.findByTestId('hosted-roster-remove-all-error');
      expect(report.textContent).toContain('Untitled');
      expect(mocks.removeAll).toHaveBeenCalledWith('ws-1');
    });
  });
});

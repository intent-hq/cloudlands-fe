/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  leave: vi.fn(),
  navigateToSettings: vi.fn(async () => {}),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-slice', () => ({
  leaveGuestSessionRequested: (id: string) => mocks.leave(id),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: mocks.navigateToSettings,
}));

import GuestEmptyState from './GuestEmptyState.svelte';

const session: GuestSessionRecord = {
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

function leaveAction(promise: Promise<unknown>) {
  return { type: 'guestSessions/leaveRequested', payload: [session.id], promise };
}

async function confirmLeave() {
  await fireEvent.click(screen.getByTestId('guest-empty-state-leave'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mocks.leave).not.toHaveBeenCalled();
  const confirmButtons = screen.getAllByRole('button', { name: 'Leave host' });
  await fireEvent.click(confirmButtons[confirmButtons.length - 1]);
}

describe('GuestEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.leave.mockImplementation(() => leaveAction(Promise.resolve({ id: session.id })));
  });

  afterEach(cleanup);

  it('names the joined host and routes Manage to the Guest Sessions settings tab', async () => {
    render(GuestEmptyState, { props: { session } });
    expect(screen.getByTestId('guest-empty-state').textContent).toContain('studio.local');

    await fireEvent.click(screen.getByRole('button', { name: 'Manage guest sessions' }));
    expect(mocks.navigateToSettings).toHaveBeenCalledWith({ tab: 'guest-sessions' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('leaves the host only after confirmation, through guestSessions/leaveRequested', async () => {
    render(GuestEmptyState, { props: { session } });

    await confirmLeave();
    expect(mocks.leave).toHaveBeenCalledWith('guest-1');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'guestSessions/leaveRequested', payload: ['guest-1'] }),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('disables Leave while the request is pending and ignores a second press', async () => {
    let release!: () => void;
    mocks.leave.mockImplementation(() =>
      leaveAction(
        new Promise((resolve) => {
          release = () => resolve({ id: session.id });
        }),
      ),
    );
    render(GuestEmptyState, { props: { session } });

    await confirmLeave();
    const leave = screen.getByTestId('guest-empty-state-leave') as HTMLButtonElement;
    await waitFor(() => expect(leave.disabled).toBe(true));
    await fireEvent.click(leave);
    expect(mocks.leave).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(leave.disabled).toBe(false));
  });

  it('surfaces a failed leave as an alert naming the host and allows a retry', async () => {
    mocks.leave.mockImplementationOnce(() => leaveAction(Promise.reject(new Error('ipc failed'))));
    render(GuestEmptyState, { props: { session } });

    await confirmLeave();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('studio.local');
    expect((screen.getByTestId('guest-empty-state-leave') as HTMLButtonElement).disabled).toBe(
      false,
    );

    await fireEvent.click(screen.getByTestId('guest-empty-state-leave'));
    const confirmButtons = screen.getAllByRole('button', { name: 'Leave host' });
    await fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import ShareWorkspaceDialog from '../ShareWorkspaceDialog.svelte';
import type { WorkspaceInvite } from '$features/workspace-sharing/types';

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
const user = { login: 'alex', githubUserId: 42, avatarUrl: null, htmlUrl: null };
const props = {
  open: true,
  canManage: true,
  workspaceId: 'ws',
  workspaceTitle: 'Intent Site',
  githubConnected: true,
  userSearchQuery: 'alex',
  userSuggestions: [user],
};
const invite: WorkspaceInvite = {
  id: 'new',
  workspaceId: 'ws',
  createdByPrincipalId: 'owner',
  pinLogin: 'alex',
  pinGithubUserId: 42,
  createdAt: '2026-10-15T00:00:00Z',
  expiresAt: '2099-10-16T00:00:00Z',
};
const settled = {
  invites: [invite],
  inviteLinks: { new: 'intent://invite?fixture=new' },
  createdLink: { inviteId: 'new', pinLogin: 'alex' },
};
const copy = () => screen.getByTestId('share-link-submit');
async function pickAlex() {
  const trigger = screen.getByRole('combobox', { name: 'Link audience' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  await fireEvent.pointerUp(await screen.findByRole('option', { name: 'A specific GitHub user' }), {
    pointerType: 'mouse',
  });
  await fireEvent.input(screen.getByRole('combobox', { name: 'Search GitHub users' }), {
    target: { value: 'alex' },
  });
  await fireEvent.click(screen.getByRole('option', { name: '@alex' }));
}
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
it('starts with anyone, no recipient field or empty guest notice, and copies only on request', async () => {
  const onCreateInvite = vi.fn();
  const { rerender } = render(ShareWorkspaceDialog, { props: { ...props, onCreateInvite } });
  expect(screen.getByRole('heading', { name: 'Share Intent Site' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Search GitHub users' })).toBeNull();
  expect(screen.queryByText('No existing guests are available to invite.')).toBeNull();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  await fireEvent.click(copy());
  expect(onCreateInvite).toHaveBeenCalledExactlyOnceWith('');
  await rerender({
    ...props,
    onCreateInvite,
    ...settled,
    invites: [{ ...invite, pinLogin: undefined, pinGithubUserId: undefined, reusable: true }],
    createdLink: { inviteId: 'new' },
  });
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(settled.inviteLinks.new),
  );
});
it('clears the recipient after creation and keeps the invite copyable at the cap', async () => {
  const onCreateInvite = vi.fn();
  const onSearchUsers = vi.fn();
  const callbacks = { onCreateInvite, onSearchUsers };
  const { rerender } = render(ShareWorkspaceDialog, { props: { ...props, ...callbacks } });
  await pickAlex();
  expect(onCreateInvite).not.toHaveBeenCalled();
  expect(copy().textContent).toContain('Create link');
  await fireEvent.click(copy());
  expect(onCreateInvite).toHaveBeenCalledExactlyOnceWith('alex');
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(copy().getAttribute('aria-busy')).toBe('true');
  expect(copy().querySelector('[data-slot="button-spinner"]')).toBeTruthy();
  await fireEvent.submit(copy().closest('form')!);
  expect(onCreateInvite).toHaveBeenCalledTimes(1);
  onSearchUsers.mockClear();
  await rerender({ ...props, ...callbacks, ...settled, guestCount: 1, guestLimit: 1 });
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('share-pin-selected')).toBeNull();
  expect(
    (screen.getByRole('combobox', { name: 'Search GitHub users' }) as HTMLInputElement).value,
  ).toBe('');
  expect(onSearchUsers).toHaveBeenLastCalledWith('');
  expect(copy().hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Invited')).toBeTruthy();
  expect(screen.queryByTestId('share-member-row')).toBeNull();
  await fireEvent.click(screen.getByTestId('share-invite-copy'));
  expect(onCreateInvite).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
  await pickAlex();
  expect(copy().textContent).toContain('Copy link');
  await fireEvent.click(copy());
  expect(onCreateInvite).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(3));
});
it('allows copy retry from the invite row after clearing the recipient, without minting another invite', async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('permission denied'));
  const onCreateInvite = vi.fn();
  const { rerender } = render(ShareWorkspaceDialog, { props: { ...props, onCreateInvite } });
  await pickAlex();
  await fireEvent.click(copy());
  await rerender({ ...props, onCreateInvite, ...settled });
  await waitFor(() => expect(screen.queryByTestId('share-pin-selected')).toBeNull());
  await fireEvent.click(screen.getByTestId('share-invite-copy'));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
  expect(onCreateInvite).toHaveBeenCalledTimes(1);
});
it('retains the recipient when creation fails so it can be retried', async () => {
  const onCreateInvite = vi.fn();
  const { rerender } = render(ShareWorkspaceDialog, { props: { ...props, onCreateInvite } });
  await pickAlex();
  await fireEvent.click(copy());
  await rerender({ ...props, onCreateInvite, createError: 'Could not create invite' });
  expect(screen.getByTestId('share-pin-selected').dataset.login).toBe('alex');
  expect(copy().hasAttribute('aria-busy')).toBe(false);
  expect(copy().textContent).toContain('Create link');
  await fireEvent.click(copy());
  expect(onCreateInvite).toHaveBeenCalledTimes(2);
});
it('does not clear a new search when the earlier clipboard write finishes', async () => {
  let finishCopy!: () => void;
  vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(
    () => new Promise<void>((resolve) => (finishCopy = resolve)),
  );
  const { rerender } = render(ShareWorkspaceDialog, {
    props: { ...props, onCreateInvite: vi.fn() },
  });
  await pickAlex();
  await fireEvent.click(copy());
  await rerender({ ...props, ...settled });
  const input = screen.getByRole('combobox', { name: 'Search GitHub users' }) as HTMLInputElement;
  await fireEvent.input(input, { target: { value: 'sam' } });
  finishCopy();
  await tick();
  expect(input.value).toBe('sam');
});
it.each([
  { open: false },
  { workspaceId: 'other' },
  { canManage: false },
  { sharingEnabled: false },
  { createError: 'Could not create invite' },
])('cancels pending copy after context or readiness changes: %j', async (change) => {
  const onCreateInvite = vi.fn();
  const { rerender } = render(ShareWorkspaceDialog, { props: { ...props, onCreateInvite } });
  await pickAlex();
  await fireEvent.click(copy());
  await rerender({ ...props, onCreateInvite, ...change });
  await rerender({ ...props, onCreateInvite, ...settled });
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});
it('never copies a preexisting createdLink when opening the dialog', async () => {
  render(ShareWorkspaceDialog, { props: { ...props, ...settled } });
  await pickAlex();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});

it('does not reinterpret a selected GitHub recipient when GitHub disconnects', async () => {
  const onCreateInvite = vi.fn();
  const both = {
    ...props,
    gitlabConnected: true,
    gitlabEnabled: true,
    gitlabHost: 'gitlab.com',
    identitySeamSupported: true,
    onCreateInvite,
  };
  const { rerender } = render(ShareWorkspaceDialog, { props: both });
  await pickAlex();
  await rerender({ ...both, githubConnected: false });
  expect(screen.getByRole('combobox', { name: 'Link audience' }).textContent).toContain(
    'A specific GitHub user',
  );
  expect(copy().hasAttribute('disabled')).toBe(true);
  await fireEvent.submit(copy().closest('form')!);
  expect(onCreateInvite).not.toHaveBeenCalled();
});

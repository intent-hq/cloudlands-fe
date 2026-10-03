/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import HostInvitationDialog from './HostInvitationDialog.svelte';

const user = {
  identity: { provider: 'github' as const, host: 'github.com', externalUserId: '42' },
  login: 'sam',
  name: 'Sam Example',
  avatarUrl: null,
};
const request = { provider: 'github' as const, host: 'github.com', query: 'sa' };
const props = () => ({
  onCreate: vi.fn(),
  onCopy: vi.fn(),
  onClose: vi.fn(),
  onSearch: vi.fn(),
  searchSupported: true,
  search: { request, users: [user], status: 'ready' as const, error: null },
});
afterEach(cleanup);

it('selects a suggestion by keyboard without submitting and renews consent', async () => {
  const callbacks = props();
  render(HostInvitationDialog, callbacks);
  const input = screen.getByRole('combobox', { name: 'Account username' });
  await fireEvent.input(input, { target: { value: 'sa' } });
  expect(callbacks.onSearch).toHaveBeenLastCalledWith(request);
  await screen.findByRole('option', { name: /Sam Example.*@sam/ });
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.keyDown(input, { key: 'ArrowDown' });
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(callbacks.onCreate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Create invite link' }).hasAttribute('disabled')).toBe(
    true,
  );
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
  expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith({
    pinLogin: 'sam',
    pinProvider: 'github',
    pinHost: 'github.com',
  });
});

it('dismisses suggestions with Escape before dismissing the dialog and rejects a stale query', async () => {
  const callbacks = props();
  render(HostInvitationDialog, callbacks);
  const input = screen.getByLabelText('Account username');
  await fireEvent.input(input, { target: { value: 'sa' } });
  await screen.findByRole('option');
  await fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await fireEvent.input(input, { target: { value: 'sarah' } });
  expect(screen.queryByRole('option')).toBeNull();
});

it('never displays GitHub hits for GitLab or a different custom host', async () => {
  const callbacks = props();
  const view = render(HostInvitationDialog, { ...callbacks, gitlabEnabled: true });
  await fireEvent.click(screen.getByRole('combobox', { name: 'Identity provider' }));
  await fireEvent.pointerUp(await screen.findByRole('option', { name: /GitLab/ }), {
    pointerType: 'mouse',
  });
  await fireEvent.input(screen.getByLabelText('GitLab instance'), {
    target: { value: 'Forge.Example:8443' },
  });
  await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sa' } });
  expect(callbacks.onSearch).toHaveBeenLastCalledWith({
    provider: 'gitlab',
    host: 'forge.example:8443',
    query: 'sa',
  });
  expect(screen.queryByRole('option', { name: /@sam/ })).toBeNull();
  const gitlabUser = {
    ...user,
    identity: { ...user.identity, provider: 'gitlab' as const, host: 'forge.example:8443' },
  };
  await view.rerender({
    ...callbacks,
    gitlabEnabled: true,
    search: {
      request: { provider: 'gitlab', host: 'forge.example:8443', query: 'sa' },
      users: [gitlabUser],
      status: 'ready',
      error: null,
    },
  });
  await fireEvent.click(await screen.findByRole('option', { name: /@sam/ }));
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.input(screen.getByLabelText('GitLab instance'), {
    target: { value: 'other.example' },
  });
  expect(screen.queryByRole('group', { name: 'Account username' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Create invite link' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.queryByRole('option', { name: /@sam/ })).toBeNull();
});

it('keeps manual entry usable on unsupported daemons and search errors', async () => {
  const callbacks = props();
  const view = render(HostInvitationDialog, { ...callbacks, searchSupported: false });
  const input = screen.getByLabelText('Account username');
  await fireEvent.input(input, { target: { value: 'sa' } });
  expect(screen.getByText(/Enter an exact account username/)).toBeTruthy();
  expect(callbacks.onSearch).not.toHaveBeenCalled();
  await view.rerender({
    ...callbacks,
    search: {
      request,
      users: [],
      status: 'error',
      error: 'Search unavailable. Enter an exact account username.',
    },
  });
  expect(
    await screen.findByText('Search unavailable. Enter an exact account username.'),
  ).toBeTruthy();
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
  expect(callbacks.onCreate).toHaveBeenCalledOnce();
});

it('bounds results, shows empty/loading states, and never submits Enter from manual entry', async () => {
  const callbacks = props();
  const view = render(HostInvitationDialog, {
    ...callbacks,
    search: { request, users: [], status: 'loading', error: null },
  });
  const input = screen.getByLabelText('Account username');
  await fireEvent.input(input, { target: { value: 'sa' } });
  expect(await screen.findByText('Searching…')).toBeTruthy();
  await view.rerender({
    ...callbacks,
    search: { request, users: [], status: 'ready', error: null },
  });
  expect(await screen.findByText(/No matching accounts/)).toBeTruthy();
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(callbacks.onCreate).not.toHaveBeenCalled();
  await view.rerender({
    ...callbacks,
    search: {
      request,
      users: Array.from({ length: 12 }, (_, i) => ({
        ...user,
        login: `sam-${i}`,
        identity: { ...user.identity, externalUserId: String(i) },
      })),
      status: 'ready',
      error: null,
    },
  });
  expect(await screen.findAllByRole('option')).toHaveLength(8);
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import HostInvitationDialog from './HostInvitationDialog.svelte';

afterEach(cleanup);
const props = () => ({ onCreate: vi.fn(), onCopy: vi.fn(), onClose: vi.fn() });

it('requires deliberate host-wide consent and renews it when the account changes', async () => {
  const callbacks = props();
  render(HostInvitationDialog, callbacks);
  expect(screen.queryByRole('combobox')).toBeNull();
  const create = screen.getByRole('button', { name: 'Create invite link' });
  expect(create.hasAttribute('disabled')).toBe(true);
  const account = screen.getByLabelText('Account username');
  await fireEvent.input(account, { target: { value: ' sam ' } });
  expect(create.hasAttribute('disabled')).toBe(true);
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.input(account, { target: { value: 'alex' } });
  expect(create.hasAttribute('disabled')).toBe(true);
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(create);
  expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith({
    pinLogin: 'alex',
    pinProvider: 'github',
    pinHost: 'github.com',
  });
});

it('keeps failures visible and prevents edits, cancellation, and duplicate creates while busy', async () => {
  const callbacks = props();
  const component = render(HostInvitationDialog, callbacks);
  await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
  await fireEvent.click(screen.getByRole('checkbox'));
  await component.rerender({ ...callbacks, busy: true });
  expect(screen.getByLabelText('Account username').hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Creating…' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await component.rerender({
    ...callbacks,
    busy: false,
    error: 'The host could not create this invite.',
  });
  expect(screen.getByRole('alert').textContent).toContain('The host could not create this invite.');
  expect(screen.getByRole('button', { name: 'Create invite link' }).hasAttribute('disabled')).toBe(
    false,
  );
});

it('offers copy and close after creation without another create action', async () => {
  const callbacks = props();
  render(HostInvitationDialog, { ...callbacks, createdLink: 'intent://invite?test=controlled' });
  expect(screen.getByRole('status').textContent).toContain('New invite link');
  expect(screen.queryByLabelText('Account username')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create invite link' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(callbacks.onCopy).toHaveBeenCalledOnce();
});

it('validates a custom GitLab host and clears its draft when the experiment is disabled', async () => {
  const callbacks = props();
  const component = render(HostInvitationDialog, { ...callbacks, gitlabEnabled: true });
  await fireEvent.click(screen.getByRole('combobox'));
  await fireEvent.pointerUp(await screen.findByRole('option', { name: /GitLab/ }), {
    pointerType: 'mouse',
  });
  await fireEvent.input(screen.getByLabelText('Account username'), { target: { value: 'sam' } });
  const host = screen.getByLabelText('GitLab instance');
  await fireEvent.input(host, { target: { value: 'https://forge.example/path' } });
  expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('alert')).toBeTruthy();
  await fireEvent.input(host, { target: { value: 'Forge.Example:8443' } });
  await fireEvent.click(screen.getByRole('checkbox'));
  await fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
  expect(callbacks.onCreate).toHaveBeenCalledWith({
    pinLogin: 'sam',
    pinProvider: 'gitlab',
    pinHost: 'forge.example:8443',
  });
  await component.rerender({ ...callbacks, gitlabEnabled: false });
  await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  expect((screen.getByLabelText('Account username') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Create invite link' }).hasAttribute('disabled')).toBe(
    true,
  );
});

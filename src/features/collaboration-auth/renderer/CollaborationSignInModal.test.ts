import { fireEvent, render, screen, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollaborationView } from '../types';
const labs = vi.hoisted(() => ({ multiplayer: true, gitlab: true, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      userPreferences: { labsMultiplayerEnabled: labs.multiplayer, labsGitLabEnabled: labs.gitlab },
    }),
    dispatch: labs.dispatch,
  });
});
import CollaborationSignInModal from './CollaborationSignInModal.svelte';
const base: CollaborationView = {
  requestId: 'dialog',
  request: { scope: 'workspace', pinIdentity: null },
  target: { provider: 'github', host: 'github.com' },
  phase: 'account',
  user: { id: '21', login: 'teammate' },
  requestedScopes: ['gist'],
  grantedScopes: ['gist'],
  deviceGrantSupported: true,
};
beforeEach(() => {
  labs.multiplayer = true;
  labs.gitlab = true;
  labs.dispatch.mockClear();
});
afterEach(cleanup);
describe('collaboration account consent controls', () => {
  it('requires an explicit account confirmation and sends no authentication on mount', async () => {
    const onAction = vi.fn();
    render(CollaborationSignInModal, { view: base, onAction });
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue as @teammate' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'confirm' });
  });
  it('a custom GitLab instance is sent only when chosen, independently of the current GitHub account', async () => {
    const onAction = vi.fn();
    render(CollaborationSignInModal, { view: base, onAction });
    await fireEvent.input(screen.getByRole('textbox', { name: /GitLab instance/ }), {
      target: { value: 'gitlab.company:8443' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^GitLab$/ }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'choose',
      target: { provider: 'gitlab', host: 'gitlab.company:8443' },
    });
  });
  it('PAT submission clears the local input and has no Redux action carrying the token', async () => {
    const onAction = vi.fn();
    const target = { provider: 'gitlab' as const, host: 'gitlab.company' };
    render(CollaborationSignInModal, {
      view: {
        ...base,
        target,
        request: { scope: 'host', pinIdentity: { ...target, externalUserId: '21' } },
        deviceGrantSupported: false,
        user: null,
      },
      onAction,
    });
    const input = screen.getByLabelText(/personal access token/);
    await fireEvent.input(input, { target: { value: 'secret-pat' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in or change account' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect', token: 'secret-pat' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(labs.dispatch).not.toHaveBeenCalled();
  });
  it('GitLab recovery opens its explicit enable command and cancels without switching identity', async () => {
    labs.gitlab = false;
    const onAction = vi.fn();
    const target = { provider: 'gitlab' as const, host: 'gitlab.company' };
    render(CollaborationSignInModal, {
      view: {
        ...base,
        target,
        request: { scope: 'host', pinIdentity: { ...target, externalUserId: '21' } },
        phase: 'error',
        error: 'gitlab-disabled',
      },
      onAction,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Review GitLab experiment' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'cancel' });
    expect(labs.dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: ['GitLab'] }));
  });
});

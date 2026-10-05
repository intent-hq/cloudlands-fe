import { fireEvent, render, screen, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { store as appStore } from '$store/renderer/store';
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
    await fireEvent.click(screen.getByRole('button', { name: /^GitLab$/ }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'choose',
      target: { provider: 'gitlab', host: 'gitlab.com' },
    });
    cleanup();
    onAction.mockClear();
    render(CollaborationSignInModal, {
      view: { ...base, target: { provider: 'gitlab', host: 'gitlab.com' }, user: null },
      onAction,
    });
    await fireEvent.click(screen.getByRole('button', { name: /Use another GitLab instance/ }));
    await fireEvent.input(screen.getByRole('textbox', { name: /GitLab instance/ }), {
      target: { value: 'gitlab.company:8443' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Use this instance/ }));
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
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with token' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect', token: 'secret-pat' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(labs.dispatch).not.toHaveBeenCalled();
  });
  it('a disabled pinned GitLab identity stays blocked without an experiment shortcut or identity switch', async () => {
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
    expect(screen.queryByRole('button', { name: 'Review GitLab experiment' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^GitHub$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Continue as/ })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Cancel', exact: true }).at(-1)!);
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'cancel' });
    expect(labs.dispatch).not.toHaveBeenCalled();
  });
});

describe('progressive collaboration sign-in', () => {
  it('keeps GitHub free of GitLab fields and starts device sign-in only on an explicit action', async () => {
    const onAction = vi.fn();
    render(CollaborationSignInModal, { view: { ...base, user: null }, onAction });
    expect(screen.queryByLabelText(/GitLab instance/)).toBeNull();
    expect(screen.queryByLabelText(/personal access token/)).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect' });
  });

  it('defaults supported GitLab to device sign-in and reveals token entry only on request', async () => {
    const onAction = vi.fn();
    const mounted = render(CollaborationSignInModal, {
      view: { ...base, target: { provider: 'gitlab', host: 'gitlab.com' }, user: null },
      onAction,
    });
    expect(screen.queryByLabelText(/personal access token/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitLab' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect' });
    onAction.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Use a token instead' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign in with GitLab' })).toBeNull();
    await fireEvent.input(screen.getByLabelText(/personal access token/), {
      target: { value: 'fixture-token' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with token' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect', token: 'fixture-token' });
    expect(screen.queryByLabelText(/personal access token/)).toBeNull();
    await mounted.rerender({
      view: { ...base, target: { provider: 'gitlab', host: 'gitlab.com' } },
      onAction,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Continue as @teammate' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'confirm' });
  });

  it('uses token fallback for the actual unsupported-device error without starting another flow', async () => {
    const onAction = vi.fn();
    render(CollaborationSignInModal, {
      view: {
        ...base,
        target: { provider: 'gitlab', host: 'gitlab.company' },
        user: null,
        phase: 'error',
        error: 'device-grant-unsupported',
        deviceGrantSupported: false,
      },
      onAction,
    });
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText(/personal access token/), {
      target: { value: 'fallback-token' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with token' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect', token: 'fallback-token' });
  });

  it('routes the device-card action through the guarded caller and still allows cancellation', async () => {
    const onAction = vi.fn();
    render(CollaborationSignInModal, {
      view: {
        ...base,
        phase: 'device',
        user: null,
        device: { userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' },
      },
      onAction,
    });
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Open sign-in page' }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'open-browser' });
    await fireEvent.click(screen.getAllByRole('button', { name: 'Cancel', exact: true }).at(-1)!);
    expect(onAction).toHaveBeenLastCalledWith({ type: 'cancel' });
  });

  it('keeps a pinned account immutable and confirms only the displayed account', async () => {
    const onAction = vi.fn();
    render(CollaborationSignInModal, {
      view: {
        ...base,
        request: { scope: 'host', pinIdentity: { ...base.target, externalUserId: '21' } },
      },
      onAction,
    });
    expect(screen.queryByRole('button', { name: /^GitHub$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^GitLab$/ })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue as @teammate' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'confirm' });
  });

  it('discards draft credentials when the request changes and does not authenticate while loading', async () => {
    const onAction = vi.fn();
    const view: CollaborationView = {
      ...base,
      target: { provider: 'gitlab', host: 'gitlab.com' },
      user: null,
    };
    const mounted = render(CollaborationSignInModal, { view, onAction });
    await fireEvent.click(screen.getByRole('button', { name: 'Use a token instead' }));
    await fireEvent.input(screen.getByLabelText(/personal access token/), {
      target: { value: 'discard-me' },
    });
    await mounted.rerender({
      view: { ...view, requestId: 'another-request', phase: 'loading' },
      onAction,
    });
    expect(screen.queryByLabelText(/personal access token/)).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    await mounted.rerender({ view: { ...view, requestId: 'another-request' }, onAction });
    await fireEvent.click(screen.getByRole('button', { name: 'Use a token instead' }));
    expect((screen.getByLabelText(/personal access token/) as HTMLInputElement).value).toBe('');
  });
});

describe('enabled collaboration forge choices', () => {
  it('offers GitHub sign-in without a chooser or Review button when GitLab is off', async () => {
    labs.gitlab = false;
    const onAction = vi.fn();
    render(CollaborationSignInModal, { view: { ...base, user: null }, onAction });
    expect(screen.queryByRole('button', { name: /^GitHub$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^GitLab$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review GitLab experiment' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'connect' });
  });

  it('falls back through the existing choice action on live disable without confirming an account', async () => {
    const onAction = vi.fn();
    const view: CollaborationView = {
      ...base,
      target: { provider: 'gitlab', host: 'gitlab.company' },
    };
    const mounted = render(CollaborationSignInModal, { view, onAction });
    expect(screen.getByRole('button', { name: /^GitHub$/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: /^GitLab$/ })).not.toBeNull();
    labs.gitlab = false;
    (appStore as unknown as { emitState(): void }).emitState();
    await tick();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'choose',
      target: { provider: 'github', host: 'github.com' },
    });
    expect(screen.queryByRole('button', { name: /Continue as/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^GitHub$/ })).toBeNull();
    await mounted.rerender({ view: { ...base, user: null }, onAction });
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).not.toBeNull();
    expect(labs.dispatch).not.toHaveBeenCalled();
  });

  it('recovers an unpinned stale disabled selection but never changes an in-flight selection', async () => {
    labs.gitlab = false;
    const onAction = vi.fn();
    const view: CollaborationView = {
      ...base,
      target: { provider: 'gitlab', host: 'gitlab.company' },
      phase: 'error',
      error: 'gitlab-disabled',
    };
    const mounted = render(CollaborationSignInModal, { view, onAction });
    await tick();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'choose',
      target: { provider: 'github', host: 'github.com' },
    });
    onAction.mockClear();
    await mounted.rerender({ view: { ...view, phase: 'loading', error: undefined }, onAction });
    expect(onAction).not.toHaveBeenCalled();
    await mounted.rerender({
      view: {
        ...view,
        phase: 'device',
        error: undefined,
        device: { userCode: 'ABCD-EFGH', verificationUri: 'https://gitlab.company/oauth/device' },
      },
      onAction,
    });
    expect(onAction).not.toHaveBeenCalled();
  });
});

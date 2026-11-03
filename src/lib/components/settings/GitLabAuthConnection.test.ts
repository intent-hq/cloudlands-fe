/**
 * @vitest-environment jsdom
 *
 * GitLabAuthConnection — the Settings › Connections GitLab row. Covers the
 * daemon capability gate: the Connect entry and connect form render only when
 * the connected daemon's protocol serves the `sourceControl.*` auth methods;
 * an older daemon (or one that has not reported a version yet) renders the
 * "daemon too old" state instead, and a later supporting poll re-enables it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';

import { initialState as preferenceDefaults } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import type { GitLabAuthState } from '$store/renderer/slices/gitlab-auth/gitlab-auth-types';
import { initialState as gitlabDefaults } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const userPreferences: { value: unknown } = { value: null };
  const gitlabAuth: { value: unknown } = { value: null };
  const daemonHealthStats: { value: unknown } = { value: null };
  return { dispatch, userPreferences, gitlabAuth, daemonHealthStats };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { createAdmittedLegacyPrincipal } =
    await import('../../../test/fixtures/admitted-legacy-principal');
  return createAppStoreMockModule({
    state: () => {
      const admitted = createAdmittedLegacyPrincipal();
      admitted.principal.snapshot!.capabilities.gitlabCheckout = true;
      return {
        ...admitted,
        userPreferences: mocks.userPreferences.value,
        gitlabAuth: mocks.gitlabAuth.value,
        daemonHealth: { ...admitted.daemonHealth, stats: mocks.daemonHealthStats.value },
      };
    },
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import GitLabAuthConnection from './GitLabAuthConnection.svelte';

const idleGitLab = (): GitLabAuthState => ({
  ...gitlabDefaults,
  statusReady: true,
  deviceGrantSupported: true,
});

// system.status stats of a daemon whose protocol serves sourceControl.* auth.
const supportingDaemonStats = () => ({
  clients: 1,
  agents: 0,
  listenMode: 'uds',
  os: 'linux',
  arch: 'x64',
  protocolVersion: CURRENT_PROTOCOL_VERSION,
});

const findButton = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label));

const tooOld = (root: HTMLElement) =>
  root.querySelector('[data-testid="gitlab-connection-daemon-too-old"]');
const connectForm = (root: HTMLElement) =>
  root.querySelector('[data-testid="gitlab-connect-form"]');

const emitState = async () => {
  const { appStore } = (await import('$store/renderer/store')) as unknown as {
    appStore: { emitState: () => void };
  };
  appStore.emitState();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userPreferences.value = { ...preferenceDefaults };
  mocks.gitlabAuth.value = idleGitLab();
  mocks.daemonHealthStats.value = supportingDaemonStats();
});

describe('GitLabAuthConnection daemon capability gate', () => {
  it('shows the full connected instance and restores it for reconnecting', async () => {
    const instanceBaseUrl = 'https://git.example.test:8443/Parent/Forge';
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      host: 'git.example.test:8443',
      instanceBaseUrl,
      isConfigured: true,
      user: { id: '7', login: 'saved' },
    };
    const { getByTestId, getByRole, getByLabelText } = render(GitLabAuthConnection);
    expect(getByTestId('gitlab-connection-host').textContent).toBe(instanceBaseUrl);

    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      host: 'git.example.test:8443',
      instanceBaseUrl,
    };
    await emitState();
    await fireEvent.click(getByRole('button', { name: 'Connect', exact: true }));
    expect((getByLabelText('GitLab instance URL') as HTMLInputElement).value).toBe(instanceBaseUrl);
  });

  it('offers new GitLab setup on a fresh profile without any opt-in', () => {
    const { container } = render(GitLabAuthConnection);
    expect(findButton(container, 'Connect')).toBeTruthy();
    expect(connectForm(container)).toBeNull();
  });

  it('keeps the saved account visible without reconnecting or logging out', async () => {
    const saved = {
      ...idleGitLab(),
      isConfigured: true,
      user: { id: '7', login: 'saved' },
      method: 'pat',
    };
    mocks.gitlabAuth.value = saved;
    const { container } = render(GitLabAuthConnection);
    expect(container.textContent).toContain('@saved');
    expect(findButton(container, 'Disconnect')).toBeTruthy();
    expect(connectForm(container)).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.gitlabAuth.value).toEqual(saved);
  });

  it('supporting daemon: offers Connect and opens the connect form', async () => {
    mocks.userPreferences.value = { ...preferenceDefaults };
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeNull();
    const connect = findButton(container, 'Connect');
    expect(connect).toBeTruthy();
    expect(connectForm(container)).toBeNull();

    await fireEvent.click(connect!);
    expect(connectForm(container)).toBeTruthy();
  });

  it('daemon protocol predating sourceControl.* auth: shows the too-old state, no Connect', () => {
    mocks.userPreferences.value = { ...preferenceDefaults };
    mocks.daemonHealthStats.value = { ...supportingDaemonStats(), protocolVersion: '10.4' }; // fixture-protocol-version: too old for sourceControl auth
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeTruthy();
    expect(findButton(container, 'Connect')).toBeUndefined();
    expect(connectForm(container)).toBeNull();
  });

  it('unknown protocol version (no system.status poll yet): treated as too old', () => {
    mocks.userPreferences.value = { ...preferenceDefaults };
    mocks.daemonHealthStats.value = null;
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeTruthy();
    expect(findButton(container, 'Connect')).toBeUndefined();
  });

  it('too-old daemon keeps the connect form closed even while a connect is flagged in flight', () => {
    mocks.userPreferences.value = { ...preferenceDefaults };
    mocks.daemonHealthStats.value = { ...supportingDaemonStats(), protocolVersion: '10.4' }; // fixture-protocol-version: too old for sourceControl auth
    mocks.gitlabAuth.value = { ...idleGitLab(), isAuthenticating: true };
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeTruthy();
    expect(connectForm(container)).toBeNull();
  });

  it('re-enables Connect once a later poll reports a supporting protocol', async () => {
    mocks.userPreferences.value = { ...preferenceDefaults };
    mocks.daemonHealthStats.value = null;
    const { container } = render(GitLabAuthConnection);
    expect(tooOld(container)).toBeTruthy();

    mocks.daemonHealthStats.value = supportingDaemonStats();
    const { appStore } = (await import('$store/renderer/store')) as unknown as {
      appStore: { emitState: () => void };
    };
    appStore.emitState();

    await waitFor(() => {
      expect(tooOld(container)).toBeNull();
      expect(findButton(container, 'Connect')).toBeTruthy();
    });
  });
});

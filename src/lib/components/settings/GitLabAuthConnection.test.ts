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

import type { GitLabAuthState } from '$store/renderer/slices/gitlab-auth/gitlab-auth-types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const gitlabAuth: { value: unknown } = { value: null };
  const daemonHealthStats: { value: unknown } = { value: null };
  return { dispatch, gitlabAuth, daemonHealthStats };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      gitlabAuth: mocks.gitlabAuth.value,
      daemonHealth: { stats: mocks.daemonHealthStats.value },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import GitLabAuthConnection from './GitLabAuthConnection.svelte';

const idleGitLab = (): GitLabAuthState => ({
  host: 'gitlab.com',
  isConfigured: false,
  isAuthenticating: false,
  deviceFlow: null,
  deviceGrantSupported: true,
  user: null,
  error: null,
  method: null,
});

// system.status stats of a daemon whose protocol serves sourceControl.* auth.
const supportingDaemonStats = () => ({
  clients: 1,
  agents: 0,
  listenMode: 'uds',
  os: 'linux',
  arch: 'x64',
  protocolVersion: '10.5',
});

const findButton = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label));

const tooOld = (root: HTMLElement) =>
  root.querySelector('[data-testid="gitlab-connection-daemon-too-old"]');
const connectForm = (root: HTMLElement) =>
  root.querySelector('[data-testid="gitlab-connect-form"]');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitlabAuth.value = idleGitLab();
  mocks.daemonHealthStats.value = supportingDaemonStats();
});

describe('GitLabAuthConnection daemon capability gate', () => {
  it('supporting daemon: offers Connect and opens the connect form', async () => {
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeNull();
    const connect = findButton(container, 'Connect');
    expect(connect).toBeTruthy();
    expect(connectForm(container)).toBeNull();

    await fireEvent.click(connect!);
    expect(connectForm(container)).toBeTruthy();
  });

  it('daemon protocol predating sourceControl.* auth: shows the too-old state, no Connect', () => {
    mocks.daemonHealthStats.value = { ...supportingDaemonStats(), protocolVersion: '10.4' };
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeTruthy();
    expect(findButton(container, 'Connect')).toBeUndefined();
    expect(connectForm(container)).toBeNull();
  });

  it('unknown protocol version (no system.status poll yet): treated as too old', () => {
    mocks.daemonHealthStats.value = null;
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeTruthy();
    expect(findButton(container, 'Connect')).toBeUndefined();
  });

  it('too-old daemon keeps the connect form closed even while a connect is flagged in flight', () => {
    mocks.daemonHealthStats.value = { ...supportingDaemonStats(), protocolVersion: '10.4' };
    mocks.gitlabAuth.value = { ...idleGitLab(), isAuthenticating: true };
    const { container } = render(GitLabAuthConnection);

    expect(tooOld(container)).toBeTruthy();
    expect(connectForm(container)).toBeNull();
  });

  it('re-enables Connect once a later poll reports a supporting protocol', async () => {
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

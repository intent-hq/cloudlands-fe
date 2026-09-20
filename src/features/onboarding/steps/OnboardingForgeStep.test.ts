/**
 * @vitest-environment jsdom
 *
 * OnboardingForgeStep — the optional "connect a forge" step between agent-CLI
 * selection and project selection. Covers: the GitHub / GitLab / Skip chooser,
 * the GitHub device flow (unchanged), the GitLab branch (host-aware device
 * grant, PAT fallback, cancel-on-skip), already-connected (Continue, no Skip),
 * the onMount hydration dispatches for both forges, and the daemon capability
 * gate that hides the GitLab option when the connected daemon's protocol does
 * not serve the `sourceControl.*` auth methods.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';

import type { GitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-types';
import {
  gitlabAuthReducer,
  setGitLabAuthError,
  setGitLabAuthStatus,
  takeGitLabPatToken,
} from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import type { GitLabAuthState } from '$store/renderer/slices/gitlab-auth/gitlab-auth-types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const githubAuth: { value: unknown } = { value: null };
  const gitlabAuth: { value: unknown } = { value: null };
  const daemonHealthStats: { value: unknown } = { value: null };
  const handleLink = vi.fn(() => Promise.resolve(true));
  return { dispatch, githubAuth, gitlabAuth, daemonHealthStats, handleLink };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      githubAuth: mocks.githubAuth.value,
      gitlabAuth: mocks.gitlabAuth.value,
      daemonHealth: { stats: mocks.daemonHealthStats.value },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: mocks.handleLink,
}));

import OnboardingForgeStep from './OnboardingForgeStep.svelte';

const idleGitHub = (): GitHubAuthState => ({
  isAuthenticated: false,
  requiresDaemonAuth: false,
  user: null,
  isAuthenticating: false,
  oauthUrl: null,
  deviceFlow: null,
  needsScopeUpdate: false,
  error: null,
});

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

const baseProps = () => ({ onContinue: vi.fn(), onSkip: vi.fn() });

const findButton = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label));

const dispatched = (type: string) =>
  mocks.dispatch.mock.calls.map(([action]) => action).filter((action) => action?.type === type);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubAuth.value = idleGitHub();
  mocks.gitlabAuth.value = idleGitLab();
  mocks.daemonHealthStats.value = supportingDaemonStats();
});

describe('OnboardingForgeStep', () => {
  it('hydrates both forges on mount (githubAuth/initialize + gitlabAuth/initialize)', async () => {
    render(OnboardingForgeStep, { props: baseProps() });
    await waitFor(() => {
      expect(dispatched('githubAuth/initialize')).toHaveLength(1);
      expect(dispatched('gitlabAuth/initialize')).toHaveLength(1);
    });
  });

  it('idle: offers GitHub, GitLab and Skip; GitHub starts the device flow, Skip advances', async () => {
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    expect(container.querySelector('[data-testid="forge-step-choices"]')).toBeTruthy();
    expect(findButton(container, 'Connect GitLab')).toBeTruthy();

    await fireEvent.click(findButton(container, 'Connect GitHub')!);
    expect(dispatched('githubAuth/startAuth')).toHaveLength(1);

    const skip = findButton(container, 'Skip for now');
    expect(skip).toBeTruthy();
    await fireEvent.click(skip!);
    expect(props.onSkip).toHaveBeenCalledOnce();
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it('hides the GitLab option when the daemon protocol predates sourceControl.* auth; GitHub and Skip remain', async () => {
    mocks.daemonHealthStats.value = { ...supportingDaemonStats(), protocolVersion: '10.4' };
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    expect(container.querySelector('[data-testid="forge-step-choices"]')).toBeTruthy();
    expect(findButton(container, 'Connect GitLab')).toBeUndefined();
    expect(findButton(container, 'Connect GitHub')).toBeTruthy();

    await fireEvent.click(findButton(container, 'Skip for now')!);
    expect(props.onSkip).toHaveBeenCalledOnce();
  });

  it('hides the GitLab option before the daemon has reported its protocol version', () => {
    mocks.daemonHealthStats.value = null;
    const { container } = render(OnboardingForgeStep, { props: baseProps() });

    expect(container.querySelector('[data-testid="forge-step-choices"]')).toBeTruthy();
    expect(findButton(container, 'Connect GitLab')).toBeUndefined();
    expect(findButton(container, 'Connect GitHub')).toBeTruthy();
  });

  it('offers the GitLab option once a later system.status poll reports a supporting protocol', async () => {
    mocks.daemonHealthStats.value = null;
    const { container } = render(OnboardingForgeStep, { props: baseProps() });
    expect(findButton(container, 'Connect GitLab')).toBeUndefined();

    mocks.daemonHealthStats.value = supportingDaemonStats();
    const { appStore } = (await import('$store/renderer/store')) as unknown as {
      appStore: { emitState: () => void };
    };
    appStore.emitState();
    await waitFor(() => expect(findButton(container, 'Connect GitLab')).toBeTruthy());
  });

  it('GitHub pending device flow: renders the code card and cancel dispatches cancelAuth', async () => {
    mocks.githubAuth.value = {
      ...idleGitHub(),
      isAuthenticating: true,
      oauthUrl: 'https://github.com/login/device',
      deviceFlow: {
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      },
    };
    const { container } = render(OnboardingForgeStep, { props: baseProps() });

    const card = container.querySelector('[data-testid="github-step-device-flow"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('ABCD-1234');
    expect(card!.textContent).toContain('https://github.com/login/device');

    await fireEvent.click(findButton(container, 'Cancel')!);
    expect(dispatched('githubAuth/cancelAuth')).toHaveLength(1);
  });

  it('GitLab: choosing it shows the host input; connect dispatches startDeviceAuth with the normalized host', async () => {
    const { container } = render(OnboardingForgeStep, { props: baseProps() });

    await fireEvent.click(findButton(container, 'Connect GitLab')!);
    const panel = container.querySelector('[data-testid="forge-step-gitlab"]');
    expect(panel).toBeTruthy();
    expect(dispatched('gitlabAuth/startDeviceAuth')).toHaveLength(0);

    const host = panel!.querySelector<HTMLInputElement>('input[type="text"]');
    expect(host).toBeTruthy();
    expect(host!.labels?.[0]?.textContent).toBeTruthy();
    await fireEvent.input(host!, { target: { value: 'https://gitlab.example.com/group/' } });
    await fireEvent.click(findButton(panel as HTMLElement, 'Connect GitLab')!);

    expect(dispatched('gitlabAuth/startDeviceAuth')).toEqual([
      expect.objectContaining({ payload: ['gitlab.example.com'] }),
    ]);
  });

  it('GitLab: an empty host falls back to gitlab.com on the wire', async () => {
    const { container } = render(OnboardingForgeStep, { props: baseProps() });
    await fireEvent.click(findButton(container, 'Connect GitLab')!);
    const panel = container.querySelector('[data-testid="forge-step-gitlab"]')!;
    const host = panel.querySelector<HTMLInputElement>('input[type="text"]')!;
    await fireEvent.input(host, { target: { value: '   ' } });
    await fireEvent.click(findButton(panel as HTMLElement, 'Connect GitLab')!);
    expect(dispatched('gitlabAuth/startDeviceAuth')).toEqual([
      expect.objectContaining({ payload: ['gitlab.com'] }),
    ]);
  });

  it('GitLab pending device grant: renders the code card; "use a token" cancels and shows the PAT field', async () => {
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      isAuthenticating: true,
      deviceFlow: {
        userCode: 'WXYZ-5678',
        verificationUri: 'https://gitlab.com/oauth/device',
        expiresIn: 300,
        interval: 5,
      },
    };
    const { container } = render(OnboardingForgeStep, { props: baseProps() });

    const flow = container.querySelector('[data-testid="gitlab-connect-device-flow"]');
    expect(flow).toBeTruthy();
    expect(flow!.textContent).toContain('WXYZ-5678');
    expect(flow!.textContent).toContain('https://gitlab.com/oauth/device');

    await fireEvent.click(findButton(container, 'Use a token instead')!);
    expect(dispatched('gitlabAuth/cancelAuth')).toHaveLength(1);

    mocks.gitlabAuth.value = idleGitLab();
    const { appStore } = (await import('$store/renderer/store')) as unknown as {
      appStore: { emitState: () => void };
    };
    appStore.emitState();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="gitlab-connect-token"]')).toBeTruthy(),
    );
  });

  it('GitLab without device grant support: leads with the PAT field and connects with host + token', async () => {
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      host: 'gitlab.example.com',
      deviceGrantSupported: false,
    };
    const { container } = render(OnboardingForgeStep, { props: baseProps() });
    await fireEvent.click(findButton(container, 'Connect GitLab')!);
    const panel = container.querySelector('[data-testid="forge-step-gitlab"]') as HTMLElement;

    const tokenField = panel.querySelector('[data-testid="gitlab-connect-token"]');
    expect(tokenField).toBeTruthy();
    const token = tokenField!.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(token.labels?.[0]?.textContent).toBeTruthy();

    const connect = findButton(panel, 'Connect GitLab')!;
    expect(connect.disabled).toBe(true);
    await fireEvent.input(token, { target: { value: '  glpat-secret  ' } });
    expect(connect.disabled).toBe(false);
    await fireEvent.click(connect);

    // The PAT rides a single-use handoff, never the action (Redux action logs).
    const connectActions = dispatched('gitlabAuth/connectWithToken');
    expect(connectActions).toEqual([
      expect.objectContaining({
        payload: { host: 'gitlab.example.com', tokenRef: expect.any(Number) },
      }),
    ]);
    expect(JSON.stringify(connectActions)).not.toContain('glpat-secret');
    expect(
      takeGitLabPatToken((connectActions[0] as { payload: { tokenRef: number } }).payload.tokenRef),
    ).toBe('glpat-secret');
    expect(dispatched('gitlabAuth/startDeviceAuth')).toHaveLength(0);
    expect(token.value).toBe('');
  });

  it("GitLab PAT: the token link opens the instance's personal access token page", async () => {
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      host: 'gitlab.example.com',
      deviceGrantSupported: false,
    };
    const { container } = render(OnboardingForgeStep, { props: baseProps() });
    await fireEvent.click(findButton(container, 'Connect GitLab')!);
    const panel = container.querySelector('[data-testid="forge-step-gitlab"]') as HTMLElement;

    await fireEvent.click(findButton(panel, 'gitlab.example.com')!);
    expect(mocks.handleLink).toHaveBeenCalledWith(
      'https://gitlab.example.com/-/user_settings/personal_access_tokens?scopes=api',
      expect.anything(),
    );
  });

  it('GitLab: an unsupported-device-grant error surfaces with the PAT field', async () => {
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      deviceGrantSupported: false,
      error: 'This GitLab instance does not support device authorization.',
    };
    const { container } = render(OnboardingForgeStep, { props: baseProps() });
    await fireEvent.click(findButton(container, 'Connect GitLab')!);
    const panel = container.querySelector('[data-testid="forge-step-gitlab"]') as HTMLElement;
    expect(panel.querySelector('[data-testid="gitlab-connect-token"]')).toBeTruthy();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain(
      'does not support device authorization',
    );
  });

  it('already connected to GitHub: shows the connected banner and Continue, no Skip', async () => {
    mocks.githubAuth.value = {
      ...idleGitHub(),
      isAuthenticated: true,
      user: { login: 'octocat', name: 'Octo Cat', email: null, avatar_url: '' },
    };
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    const banner = container.querySelector('[data-testid="forge-step-connected"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain('@octocat');

    expect(findButton(container, 'Skip for now')).toBeUndefined();
    const cont = findButton(container, 'Continue');
    expect(cont).toBeTruthy();
    await fireEvent.click(cont!);
    expect(props.onContinue).toHaveBeenCalledOnce();
  });

  it('already connected to GitLab: shows provider, @login and host, and Continue', async () => {
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      host: 'gitlab.example.com',
      isConfigured: true,
      method: 'pat',
      user: { id: 7, login: 'jdoe', displayName: 'J. Doe' },
    };
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    const banner = container.querySelector('[data-testid="forge-step-connected"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain('@jdoe');
    expect(banner!.textContent).toContain('gitlab.example.com');
    expect(banner!.querySelector('[data-icon="gitlab"]')).toBeTruthy();

    expect(findButton(container, 'Skip for now')).toBeUndefined();
    await fireEvent.click(findButton(container, 'Continue')!);
    expect(props.onContinue).toHaveBeenCalledOnce();
  });

  it('a GitLab credential the daemon expired renders disconnected again, with the error and Connect', async () => {
    const connected: GitLabAuthState = {
      ...idleGitLab(),
      host: 'gitlab.example.com',
      isConfigured: true,
      method: 'device',
      user: { id: 7, login: 'jdoe', displayName: 'J. Doe' },
    };
    // What the saga dispatches for an `expired` event once the daemon reports
    // the host unconfigured (see gitlab-auth-saga.test.ts).
    const expired = [
      setGitLabAuthError('The GitLab device code expired. Please try again.'),
      setGitLabAuthStatus({
        host: 'gitlab.example.com',
        isConfigured: false,
        deviceGrantSupported: true,
        user: null,
        method: null,
      }),
    ].reduce(gitlabAuthReducer, connected);
    mocks.gitlabAuth.value = expired;
    const { container } = render(OnboardingForgeStep, { props: baseProps() });

    expect(container.querySelector('[data-testid="forge-step-connected"]')).toBeNull();
    expect(container.textContent).not.toContain('@jdoe');
    expect(findButton(container, 'Skip for now')).toBeTruthy();
    await fireEvent.click(findButton(container, 'Connect GitLab')!);
    const panel = container.querySelector('[data-testid="forge-step-gitlab"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('The GitLab device code expired. Please try again.');
    expect(findButton(panel, 'Connect GitLab')).toBeTruthy();
  });

  it('skipping while a GitHub flow is starting cancels it before advancing', async () => {
    mocks.githubAuth.value = { ...idleGitHub(), isAuthenticating: true };
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    await fireEvent.click(findButton(container, 'Skip for now')!);
    expect(dispatched('githubAuth/cancelAuth')).toHaveLength(1);
    expect(props.onSkip).toHaveBeenCalledOnce();
  });

  it('skipping while a GitLab grant is pending cancels it before advancing', async () => {
    mocks.gitlabAuth.value = {
      ...idleGitLab(),
      isAuthenticating: true,
      deviceFlow: {
        userCode: 'WXYZ-5678',
        verificationUri: 'https://gitlab.com/oauth/device',
        expiresIn: 300,
        interval: 5,
      },
    };
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    await fireEvent.click(findButton(container, 'Skip for now')!);
    expect(dispatched('gitlabAuth/cancelAuth')).toHaveLength(1);
    expect(dispatched('githubAuth/cancelAuth')).toHaveLength(0);
    expect(props.onSkip).toHaveBeenCalledOnce();
  });

  it('skipping when idle does not dispatch any cancelAuth', async () => {
    const props = baseProps();
    const { container } = render(OnboardingForgeStep, { props });

    await fireEvent.click(findButton(container, 'Skip for now')!);
    expect(dispatched('githubAuth/cancelAuth')).toHaveLength(0);
    expect(dispatched('gitlabAuth/cancelAuth')).toHaveLength(0);
    expect(props.onSkip).toHaveBeenCalledOnce();
  });

  it('renders the GitHub auth error when present', () => {
    mocks.githubAuth.value = { ...idleGitHub(), error: 'Device flow expired' };
    const { container } = render(OnboardingForgeStep, { props: baseProps() });
    expect(container.textContent).toContain('Device flow expired');
  });
});

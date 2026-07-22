/**
 * @vitest-environment jsdom
 *
 * OnboardingGitHubStep — the optional GitHub device-token step between
 * agent-CLI selection and project selection. Covers: idle (Connect + Skip),
 * pending device flow (code card + cancel), already-connected (Continue, no
 * Skip), and the onMount hydration dispatch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

import type { GitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const githubAuth: { value: unknown } = { value: null };
  return { dispatch, githubAuth };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ githubAuth: mocks.githubAuth.value }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: vi.fn(() => Promise.resolve()),
}));

import OnboardingGitHubStep from './OnboardingGitHubStep.svelte';

const idleState = (): GitHubAuthState => ({
  isAuthenticated: false,
  requiresDaemonAuth: false,
  user: null,
  isAuthenticating: false,
  oauthUrl: null,
  deviceFlow: null,
  needsScopeUpdate: false,
  error: null,
});

const baseProps = () => ({ onContinue: vi.fn(), onSkip: vi.fn() });

const findButton = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubAuth.value = idleState();
});

describe('OnboardingGitHubStep', () => {
  it('hydrates auth state on mount (githubAuth/initialize)', () => {
    render(OnboardingGitHubStep, { props: baseProps() });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'githubAuth/initialize' }),
    );
  });

  it('idle: shows Connect GitHub and Skip for now; connect dispatches startAuth', async () => {
    const props = baseProps();
    const { container } = render(OnboardingGitHubStep, { props });

    const connect = findButton(container, 'Connect GitHub');
    expect(connect).toBeTruthy();
    await fireEvent.click(connect!);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'githubAuth/startAuth' }),
    );

    const skip = findButton(container, 'Skip for now');
    expect(skip).toBeTruthy();
    await fireEvent.click(skip!);
    expect(props.onSkip).toHaveBeenCalledOnce();
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it('pending device flow: renders the code card and cancel dispatches cancelAuth', async () => {
    mocks.githubAuth.value = {
      ...idleState(),
      isAuthenticating: true,
      oauthUrl: 'https://github.com/login/device',
      deviceFlow: {
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      },
    };
    const { container } = render(OnboardingGitHubStep, { props: baseProps() });

    const card = container.querySelector('[data-testid="github-step-device-flow"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('ABCD-1234');
    expect(card!.textContent).toContain('https://github.com/login/device');
    expect(card!.textContent).toContain('Waiting for authorization');

    await fireEvent.click(findButton(container, 'Cancel')!);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'githubAuth/cancelAuth' }),
    );
  });

  it('already connected: shows the connected banner and Continue, no Skip', async () => {
    mocks.githubAuth.value = {
      ...idleState(),
      isAuthenticated: true,
      user: { login: 'octocat', name: 'Octo Cat', email: null, avatar_url: '' },
    };
    const props = baseProps();
    const { container } = render(OnboardingGitHubStep, { props });

    const banner = container.querySelector('[data-testid="github-step-connected"]');
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain('@octocat');

    expect(findButton(container, 'Skip for now')).toBeUndefined();
    const cont = findButton(container, 'Continue');
    expect(cont).toBeTruthy();
    await fireEvent.click(cont!);
    expect(props.onContinue).toHaveBeenCalledOnce();
  });

  it('renders the auth error when present', () => {
    mocks.githubAuth.value = { ...idleState(), error: 'Device flow expired' };
    const { container } = render(OnboardingGitHubStep, { props: baseProps() });
    expect(container.textContent).toContain('Device flow expired');
  });
});

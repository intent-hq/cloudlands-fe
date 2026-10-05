/**
 * @vitest-environment jsdom
 *
 * GitLabConnectForm — which connect path the form leads with. Device-grant
 * support is only known once `sourceControl.authStatus` has been read for the
 * host; until then the form must keep the device path (the saga falls back to
 * the PAT path when the instance refuses the grant), not present the PAT
 * field as if support were confirmed absent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';

import type { GitLabAuthState } from '$store/renderer/slices/gitlab-auth/gitlab-auth-types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const handleLink = vi.fn();
  const gitlabAuth: { value: unknown } = { value: null };
  const setupSupported: { value: boolean | undefined } = { value: true };
  const currentAdmission = { value: true };
  return { dispatch, handleLink, gitlabAuth, setupSupported, currentAdmission };
});

vi.mock('$features/navigation/link-handler', () => ({ handleLink: mocks.handleLink }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { createAdmittedLegacyPrincipal } =
    await import('../../test/fixtures/admitted-legacy-principal');
  return createAppStoreMockModule({
    state: () => {
      const admitted = createAdmittedLegacyPrincipal();
      admitted.principal.snapshot!.capabilities.gitlabCheckout = mocks.setupSupported.value;
      if (!mocks.currentAdmission.value) admitted.principal.context = 'stale-admission';
      return { ...admitted, gitlabAuth: mocks.gitlabAuth.value };
    },
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import GitLabConnectForm from './GitLabConnectForm.svelte';
import {
  initialState,
  takeGitLabPatToken,
} from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';

const notYetHydrated = (): GitLabAuthState => ({ ...initialState });

const tokenField = (root: HTMLElement) =>
  root.querySelector('[data-testid="gitlab-connect-token"]');
const hostInput = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('input[type="text"]')!;
const dispatched = (type: string) =>
  mocks.dispatch.mock.calls.map(([action]) => action).filter((action) => action?.type === type);

const emitState = async () => {
  const { appStore } = (await import('$store/renderer/store')) as unknown as {
    appStore: { emitState: () => void };
  };
  appStore.emitState();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gitlabAuth.value = notYetHydrated();
  mocks.setupSupported.value = true;
  mocks.currentAdmission.value = true;
});

describe('GitLabConnectForm before the daemon status is hydrated', () => {
  it('leads with the device path and Enter on the host starts the device grant', async () => {
    const { container } = render(GitLabConnectForm);

    expect(tokenField(container)).toBeNull();
    const host = hostInput(container);
    host.focus();
    await fireEvent.keyDown(host, { key: 'Enter' });

    expect(dispatched('gitlabAuth/startDeviceAuth')).toEqual([
      expect.objectContaining({ payload: ['https://gitlab.com'] }),
    ]);
    expect(document.activeElement).toBe(host);
  });

  it('switches to the PAT field once the daemon reports the host does not support the grant', async () => {
    const { container } = render(GitLabConnectForm);
    expect(tokenField(container)).toBeNull();

    mocks.gitlabAuth.value = { ...notYetHydrated(), deviceGrantSupported: false };
    await emitState();
    await waitFor(() => expect(tokenField(container)).toBeTruthy());

    await fireEvent.keyDown(hostInput(container), { key: 'Enter' });
    expect(dispatched('gitlabAuth/startDeviceAuth')).toHaveLength(0);
  });

  it('keeps the device path once the daemon confirms support', async () => {
    mocks.gitlabAuth.value = { ...notYetHydrated(), deviceGrantSupported: true };
    const { container } = render(GitLabConnectForm);

    expect(tokenField(container)).toBeNull();
    await fireEvent.keyDown(hostInput(container), { key: 'Enter' });
    expect(dispatched('gitlabAuth/startDeviceAuth')).toHaveLength(1);
  });
});

describe('GitLabConnectForm complete instance setup', () => {
  const instance = 'https://git.example.test:8443/Forge';

  it.each([false, undefined])(
    'requires advertised setup support instead of falling back to a bare host: %s',
    async (supported) => {
      mocks.setupSupported.value = supported;
      mocks.gitlabAuth.value = { ...notYetHydrated(), instanceBaseUrl: instance };
      const { getByLabelText, getByRole, getByTestId } = render(GitLabConnectForm);
      const input = getByLabelText('GitLab instance URL') as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect((getByRole('button', { name: 'Connect GitLab' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(getByTestId('gitlab-instance-update-required').textContent).toMatch(/update/i);
      await fireEvent.input(input, { target: { value: `${instance}/Other` } });
      await fireEvent.change(input);
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(dispatched('gitlabAuth/initialize')).toHaveLength(0);
      expect(dispatched('gitlabAuth/startDeviceAuth')).toHaveLength(0);
      expect(dispatched('gitlabAuth/connectWithToken')).toHaveLength(0);
    },
  );

  it('enables setup after an admitted supporting connection arrives without resetting the instance', async () => {
    mocks.setupSupported.value = undefined;
    mocks.gitlabAuth.value = { ...notYetHydrated(), instanceBaseUrl: instance };
    const { getByLabelText, getByRole, queryByTestId } = render(GitLabConnectForm);
    const input = getByLabelText('GitLab instance URL') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    mocks.setupSupported.value = true;
    await emitState();
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe(instance);
    expect(queryByTestId('gitlab-instance-update-required')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'Connect GitLab' }));
    expect(dispatched('gitlabAuth/startDeviceAuth')).toEqual([
      expect.objectContaining({ payload: [instance] }),
    ]);
  });

  it('clears the entered PAT and stops setup when the admitted connection becomes stale', async () => {
    const { getByLabelText, getByRole } = render(GitLabConnectForm);
    await fireEvent.click(getByRole('button', { name: 'Use a token instead' }));
    const token = getByLabelText('Personal access token') as HTMLInputElement;
    await fireEvent.input(token, { target: { value: 'sentinel-stale-admission-pat' } });
    mocks.currentAdmission.value = false;
    await emitState();
    await waitFor(() => expect(token.disabled).toBe(true));
    expect(token.value).toBe('');
    expect((getByRole('button', { name: 'Connect GitLab' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await fireEvent.keyDown(token, { key: 'Enter' });
    expect(dispatched('gitlabAuth/connectWithToken')).toHaveLength(0);
  });

  it('restores the complete instance after delayed status without overwriting a typed address', async () => {
    const { getByLabelText } = render(GitLabConnectForm);
    const input = getByLabelText('GitLab instance URL') as HTMLInputElement;
    mocks.gitlabAuth.value = { ...notYetHydrated(), instanceBaseUrl: instance };
    await emitState();
    await waitFor(() => expect(input.value).toBe(instance));
    await fireEvent.input(input, { target: { value: `${instance}/Other` } });
    mocks.gitlabAuth.value = { ...notYetHydrated(), instanceBaseUrl: `${instance}/Updated` };
    await emitState();
    expect(input.value).toBe(`${instance}/Other`);
  });

  it('checks a distinct prefix on the same authority and does not inherit its device support', async () => {
    mocks.gitlabAuth.value = {
      ...notYetHydrated(),
      host: 'git.example.test:8443',
      instanceBaseUrl: instance,
      deviceGrantSupported: false,
    };
    const { container, getByLabelText } = render(GitLabConnectForm);
    expect(tokenField(container)).not.toBeNull();
    const input = getByLabelText('GitLab instance URL');
    await fireEvent.input(input, { target: { value: `${instance}/Other` } });
    await fireEvent.change(input);
    expect(tokenField(container)).toBeNull();
    expect(dispatched('gitlabAuth/initialize')).toEqual([
      expect.objectContaining({ payload: [`${instance}/Other`] }),
    ]);
  });

  it.each([
    'http://git.example.test/Forge',
    'https://person:secret@git.example.test/Forge',
    'https://git.example.test/Forge?query=unsafe',
    'https://git.example.test/Forge/../Other',
  ])('rejects invalid instance input before starting any auth request: %s', async (invalid) => {
    const { getByLabelText, getByRole } = render(GitLabConnectForm);
    const input = getByLabelText('GitLab instance URL');
    await fireEvent.input(input, { target: { value: invalid } });
    await fireEvent.change(input);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((getByRole('button', { name: 'Connect GitLab' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(dispatched('gitlabAuth/initialize')).toHaveLength(0);
    expect(dispatched('gitlabAuth/startDeviceAuth')).toHaveLength(0);
  });

  it('keeps the HTTPS origin, port and case-sensitive prefix when starting device authorization', async () => {
    const { getByLabelText, getByRole } = render(GitLabConnectForm);
    await fireEvent.input(getByLabelText('GitLab instance URL'), {
      target: { value: `${instance}/` },
    });
    await fireEvent.click(getByRole('button', { name: 'Connect GitLab' }));

    expect(dispatched('gitlabAuth/startDeviceAuth')).toEqual([
      expect.objectContaining({ payload: [instance] }),
    ]);
  });

  it('opens the token creation page beneath the complete selected instance prefix', async () => {
    const { getByLabelText, getByRole } = render(GitLabConnectForm);
    await fireEvent.input(getByLabelText('GitLab instance URL'), {
      target: { value: `${instance}/` },
    });
    await fireEvent.click(getByRole('button', { name: 'Use a token instead' }));
    await fireEvent.click(getByRole('button', { name: /^Create one on/ }));

    expect(mocks.handleLink).toHaveBeenCalledWith(
      `${instance}/-/user_settings/personal_access_tokens?scopes=api`,
      expect.anything(),
    );
  });

  it('allows cancelling a pending PAT connection without a device-code card', async () => {
    mocks.gitlabAuth.value = {
      ...notYetHydrated(),
      isAuthenticating: true,
      deviceFlow: null,
    };
    const onCancel = vi.fn();
    const { getByRole, getByText } = render(GitLabConnectForm, { onCancel });
    await fireEvent.click(getByRole('button', { name: 'Cancel' }));

    expect(dispatched('gitlabAuth/cancelAuth')).toHaveLength(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(getByText('Connecting to GitLab...')).toBeTruthy();
  });

  it('sends a PAT to the complete instance and erases it from the input immediately', async () => {
    const { getByLabelText, getByRole } = render(GitLabConnectForm);
    await fireEvent.input(getByLabelText('GitLab instance URL'), {
      target: { value: instance },
    });
    await fireEvent.click(getByRole('button', { name: 'Use a token instead' }));
    const token = getByLabelText('Personal access token') as HTMLInputElement;
    await fireEvent.input(token, { target: { value: 'sentinel-setup-pat' } });
    await fireEvent.click(getByRole('button', { name: 'Connect GitLab' }));
    const [action] = dispatched('gitlabAuth/connectWithToken');
    expect(action.payload.host).toBe(instance);
    expect(takeGitLabPatToken(action.payload.tokenRef)).toBe('sentinel-setup-pat');
    expect(token.value).toBe('');
  });

  it('clears the entered PAT when the user changes the target instance', async () => {
    const { getByLabelText, getByRole } = render(GitLabConnectForm);
    await fireEvent.click(getByRole('button', { name: 'Use a token instead' }));
    const token = getByLabelText('Personal access token') as HTMLInputElement;
    await fireEvent.input(token, { target: { value: 'sentinel-original-instance-pat' } });
    await fireEvent.input(getByLabelText('GitLab instance URL'), {
      target: { value: instance },
    });
    expect(token.value).toBe('');
    expect((getByRole('button', { name: 'Connect GitLab' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(dispatched('gitlabAuth/connectWithToken')).toHaveLength(0);
  });

  it('keeps pending cancellation visible and disables repeated cancel requests', () => {
    mocks.gitlabAuth.value = {
      ...notYetHydrated(),
      instanceBaseUrl: instance,
      isAuthenticating: true,
      isCancelling: true,
    };
    const { getByRole, getByTestId } = render(GitLabConnectForm);
    expect(getByTestId('gitlab-connect-instance').textContent).toBe(instance);
    expect((getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['already-started', 'failed'])(
    'offers an actual status check after cancellation outcome %s without claiming cancellation',
    async (cancelOutcome) => {
      mocks.gitlabAuth.value = {
        ...notYetHydrated(),
        instanceBaseUrl: instance,
        isAuthenticating: true,
        isCancelling: false,
        cancelOutcome,
      };
      const { getByRole, queryByText } = render(GitLabConnectForm);
      expect(queryByText('Connection cancelled.')).toBeNull();
      await fireEvent.click(getByRole('button', { name: 'Check connection status' }));
      expect(dispatched('gitlabAuth/checkAuthStatus')).toHaveLength(1);
    },
  );
});

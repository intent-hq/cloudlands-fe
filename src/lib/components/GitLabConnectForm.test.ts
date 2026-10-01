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
  const gitlabAuth: { value: unknown } = { value: null };
  return { dispatch, gitlabAuth };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ gitlabAuth: mocks.gitlabAuth.value }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import GitLabConnectForm from './GitLabConnectForm.svelte';
import { initialState } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';

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
});

describe('GitLabConnectForm before the daemon status is hydrated', () => {
  it('leads with the device path and Enter on the host starts the device grant', async () => {
    const { container } = render(GitLabConnectForm);

    expect(tokenField(container)).toBeNull();
    const host = hostInput(container);
    host.focus();
    await fireEvent.keyDown(host, { key: 'Enter' });

    expect(dispatched('gitlabAuth/startDeviceAuth')).toEqual([
      expect.objectContaining({ payload: [initialState.host] }),
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

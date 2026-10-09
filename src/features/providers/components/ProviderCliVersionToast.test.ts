/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { StoreState } from '$store/renderer/types';

const mocks = vi.hoisted(() => ({
  state: {} as StoreState,
  dispatch: vi.fn(),
  request: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const module = createAppStoreMockModule({
    state: () => mocks.state,
    dispatch: mocks.dispatch,
    dedupeEmits: true,
  });
  const { select } = await import('redux-saga/effects');
  const createSelector = module.store.createSelector;
  module.store.createSelector = (...args: Parameters<typeof createSelector>) => {
    const selector = createSelector(...args);
    selector.effect = function* () {
      return yield select(selector.select);
    };
    return selector;
  };
  return module;
});
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { warning: mocks.warning } }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  return { page: writable({ url: new URL('http://localhost/workspace/example') }) };
});

import { page } from '$app/stores';
import { store } from '$store/renderer/store';
import { withHostPrincipal } from '../../../test/fixtures/principal-state';
import {
  hostRequirementsReducer,
  initialState,
  hostRequirementsReset,
} from '$store/renderer/slices/host-requirements/host-requirements-slice';
import { hostRequirementsSaga } from '$store/renderer/slices/host-requirements/sagas/host-requirements-saga';
import ProviderCliVersionToast, {
  resetProviderCliVersionToastSession,
} from './ProviderCliVersionToast.svelte';

const oldCodex = {
  id: 'codex',
  displayName: 'Codex',
  command: 'codex-acp',
  installed: true,
  hasNpxFallback: true,
  cliCommand: 'codex',
  cliResolved: true,
  cliResolvedPath: '/remote/bin/codex',
  cliVersion: 'codex-cli 0.114.0',
  cliRequirement: 'Codex CLI 0.159.1+',
  cliVersionRange: '^0.159.1',
  cliMinimumVersion: '0.159.1',
  cliVersionOk: false,
};
const emit = () => (store as unknown as { emitState(): void }).emitState();
const settle = async () => {
  await tick();
  await Promise.resolve();
  await tick();
};
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let task: Task;
let channel: ReturnType<typeof stdChannel>;
function startSaga() {
  channel = stdChannel();
  mocks.dispatch.mockImplementation((action) => {
    mocks.state = {
      ...mocks.state,
      hostRequirements: hostRequirementsReducer(mocks.state.hostRequirements, action),
    };
    emit();
    channel.put(action);
  });
  task = runSaga(
    { channel, dispatch: mocks.dispatch, getState: () => mocks.state },
    hostRequirementsSaga,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProviderCliVersionToastSession();
  mocks.state = withHostPrincipal({ hostRequirements: initialState });
  (page as unknown as { set(value: unknown): void }).set({
    url: new URL('http://localhost/workspace/example'),
  });
  mocks.request.mockResolvedValue({ providers: [oldCodex] });
  startSaga();
});
afterEach(() => task.cancel());

describe('provider CLI startup warnings', () => {
  it('uses the daemon discovery contract and includes provider, detected version and requirement', async () => {
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.request.mock.calls).toEqual([['host.providerDiscovery', {}]]);
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    const message = mocks.warning.mock.calls[0][0];
    for (const value of ['Codex', 'codex-cli 0.114.0', '0.159.1']) expect(message).toContain(value);
  });

  it.each([
    { cliVersion: 'codex-cli 0.159.1', cliVersionOk: true },
    { cliVersion: undefined },
    { cliVersion: '' },
    { cliVersion: 'unable to determine version', cliVersionOk: undefined },
    { cliVersion: '0.80.4.9', cliVersionOk: undefined },
    { cliMinimumVersion: undefined },
    { cliMinimumVersion: '' },
    { cliVersionOk: undefined },
    { cliResolved: false },
    { gatedOff: 'disabled' },
  ])(
    'does not mislabel unknown, supported, missing or undeclared versions: %j',
    async (override) => {
      mocks.request.mockResolvedValue({ providers: [{ ...oldCodex, ...override }] });
      render(ProviderCliVersionToast);
      await settle();
      expect(mocks.warning).not.toHaveBeenCalled();
    },
  );

  it('does not warn for legacy Pi too-old or unknown verdicts without an adapter minimum', async () => {
    mocks.request.mockResolvedValue({
      providers: [
        {
          ...oldCodex,
          id: 'pi',
          displayName: 'Pi',
          installed: false,
          cliVersion: 'v0.79.0',
          cliRequirement: 'Pi CLI 0.81.0+',
          cliMinimumVersion: undefined,
          cliVersionRange: undefined,
        },
        {
          ...oldCodex,
          id: 'legacy-pi',
          displayName: 'Pi',
          cliVersion: 'unknown',
          cliMinimumVersion: undefined,
          cliVersionRange: undefined,
        },
      ],
    });
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('does not warn for a newer CLI outside the adapter range when it meets the derived minimum', async () => {
    // ^0.159.1 excludes 0.160.0, but this is a minimum warning, not a range rejection.
    mocks.request.mockResolvedValue({
      providers: [
        {
          ...oldCodex,
          cliVersion: 'codex-cli 0.160.0',
          cliVersionRange: '^0.159.1',
          cliMinimumVersion: '0.159.1',
          cliVersionOk: true,
        },
      ],
    });
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.request.mock.calls).toEqual([['host.providerDiscovery', {}]]);
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('ignores failed discovery', async () => {
    mocks.request.mockRejectedValue(new Error('offline'));
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('deduplicates emissions, remounts and reconnects to the same host', async () => {
    const first = render(ProviderCliVersionToast);
    await settle();
    emit();
    await settle();
    first.unmount();
    render(ProviderCliVersionToast);
    await settle();
    mocks.state = withHostPrincipal({ ...mocks.state, daemonHealth: { connectionGeneration: 2 } });
    emit();
    await settle();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it('warns independently for a different daemon', async () => {
    render(ProviderCliVersionToast);
    await settle();
    mocks.state = withHostPrincipal({
      ...mocks.state,
      connections: { windowBackendId: 'remote-B' },
    });
    emit();
    await settle();
    expect(mocks.warning).toHaveBeenCalledTimes(2);
  });

  it.each(['member', 'guest'] as const)('does not probe or warn for a %s', async (role) => {
    mocks.state = withHostPrincipal({ hostRequirements: initialState }, role);
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('waits for healthy owner admission and skips onboarding', async () => {
    (page as unknown as { set(value: unknown): void }).set({
      url: new URL('http://localhost/workspace/new'),
    });
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.warning).not.toHaveBeenCalled();
    mocks.state.daemonHealth.health = 'down';
    emit();
    (page as unknown as { set(value: unknown): void }).set({
      url: new URL('http://localhost/workspace/example'),
    });
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.state = withHostPrincipal({ hostRequirements: initialState });
    emit();
    await settle();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it('discards a late reply after connection replacement and does not reuse old state', async () => {
    const pending = deferred();
    mocks.request.mockReturnValueOnce(pending.promise).mockResolvedValue({ providers: [] });
    render(ProviderCliVersionToast);
    await settle();
    // The production owner-services lifetime cancels its children and resets diagnostics.
    task.cancel();
    mocks.state = withHostPrincipal({
      hostRequirements: initialState,
      connections: { windowBackendId: 'remote-B' },
    });
    startSaga();
    mocks.dispatch(hostRequirementsReset());
    await settle();
    pending.resolve({ providers: [oldCodex] });
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('does not trust a reply from a replaced daemon even before the owner lifetime cancels', async () => {
    const pending = deferred();
    mocks.request.mockReturnValue(pending.promise);
    render(ProviderCliVersionToast);
    await settle();
    mocks.state = withHostPrincipal({
      hostRequirements: initialState,
      connections: { windowBackendId: 'replacement' },
    });
    emit();
    await settle();
    pending.resolve({ providers: [oldCodex] });
    await settle();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.state.hostRequirements.providerCli).toBeUndefined();
  });

  it('waits until owner identity is loaded', async () => {
    mocks.state.principal.status = 'loading';
    render(ProviderCliVersionToast);
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.state = withHostPrincipal({ hostRequirements: initialState });
    emit();
    await settle();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it('discards a response after owner authority is lost', async () => {
    const pending = deferred();
    mocks.request.mockReturnValue(pending.promise);
    render(ProviderCliVersionToast);
    await settle();
    mocks.state = withHostPrincipal(mocks.state, 'member');
    emit();
    await settle();
    pending.resolve({ providers: [oldCodex] });
    await settle();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.state.hostRequirements.providerCli).toBeUndefined();
  });
});

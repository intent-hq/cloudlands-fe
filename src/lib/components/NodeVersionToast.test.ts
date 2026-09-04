/**
 * @vitest-environment jsdom
 *
 * NodeVersionToast — once-per-session Node.js requirement warning in the
 * (app) shell. Covers: the toast fires for an unmet node requirement outside
 * onboarding (once per session, across remounts), stays quiet during
 * onboarding (/workspace/new), before the fresh probe settles, and when the
 * requirement is met; the daemon-health-gated fresh-probe dispatch; and the
 * regression where stale ok:false state from a probe that failed during a
 * daemon outage (e.g. onboarding's ungated ensure) must never raise a false
 * warning — only a probe observed to run and settle while healthy is trusted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

import type { HostRequirementsState } from '$store/renderer/slices/host-requirements/host-requirements-types';
import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const hostRequirements: { value: unknown } = { value: null };
  const daemonHealth: { value: string } = { value: 'healthy' };
  const route: { pathname: string } = { pathname: '/workspace/abc123' };
  const toastWarning = vi.fn();
  return { dispatch, hostRequirements, daemonHealth, route, toastWarning };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      hostRequirements: mocks.hostRequirements.value,
      daemonHealth: { health: mocks.daemonHealth.value },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: { url: { pathname: string } }) => void) => {
      run({ url: { pathname: mocks.route.pathname } });
      return () => {};
    },
  },
}));

vi.mock('svelte-sonner', () => ({
  toast: { warning: mocks.toastWarning },
}));

import NodeVersionToast, { resetNodeVersionToastSessionLatch } from './NodeVersionToast.svelte';
import { store as mockStore } from '$store/renderer/store';

const stateWithNode = (
  node: HostRequirementsState['node'],
  checking = false,
): HostRequirementsState => ({
  git: { checked: true, available: true, version: '2.44.0' },
  node,
  gh: { checked: true, available: true, version: '2.62.0' },
  checking,
  hasCheckedOnce: true,
});

const emitState = () => (mockStore as unknown as { emitState: () => void }).emitState();

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Drive the fresh-probe handshake: probe observed running, then settling. */
const settleProbe = async (node: HostRequirementsState['node']) => {
  mocks.hostRequirements.value = stateWithNode({ checked: false, ok: false }, true);
  emitState();
  await tick();
  mocks.hostRequirements.value = stateWithNode(node);
  emitState();
  await tick();
};

beforeEach(() => {
  vi.clearAllMocks();
  resetNodeVersionToastSessionLatch();
  mocks.route.pathname = '/workspace/abc123';
  mocks.daemonHealth.value = 'healthy';
  mocks.hostRequirements.value = stateWithNode({ checked: false, ok: false });
});

describe('NodeVersionToast', () => {
  it('warns once when the fresh probe settles with an unmet node requirement', async () => {
    render(NodeVersionToast);
    await settleProbe({ checked: true, ok: false, version: '18.19.0' });
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      m.lib_nodeVersionWarning_haveVersion_message({
        minimumVersion: MINIMUM_NODE_VERSION,
        nodeVersion: '18.19.0',
      }),
    );
  });

  it('uses the not-found copy when no node version was probed', async () => {
    render(NodeVersionToast);
    await settleProbe({ checked: true, ok: false });
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      m.lib_nodeVersionWarning_notFound_message({ minimumVersion: MINIMUM_NODE_VERSION }),
    );
  });

  it('fires only once per session, even across remounts', async () => {
    const first = render(NodeVersionToast);
    await settleProbe({ checked: true, ok: false, version: '18.19.0' });
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    first.unmount();

    render(NodeVersionToast);
    await settleProbe({ checked: true, ok: false, version: '18.19.0' });
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
  });

  it('stays quiet during onboarding (/workspace/new)', async () => {
    mocks.route.pathname = '/workspace/new';
    render(NodeVersionToast);
    await settleProbe({ checked: true, ok: false, version: '18.19.0' });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('stays quiet while the probe is in flight and when the requirement is met', async () => {
    const pending = render(NodeVersionToast);
    mocks.hostRequirements.value = stateWithNode({ checked: false, ok: false }, true);
    emitState();
    await tick();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    pending.unmount();

    render(NodeVersionToast);
    await settleProbe({ checked: true, ok: true, version: '22.4.0' });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('requests a fresh probe once the daemon is healthy — not before', async () => {
    mocks.daemonHealth.value = 'down';
    render(NodeVersionToast);
    await tick();
    expect(mocks.dispatch).not.toHaveBeenCalled();

    mocks.daemonHealth.value = 'healthy';
    emitState();
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'hostRequirements/checkHostRequirementsRequested' }),
      ),
    );
  });

  it('never trusts stale ok:false state from a probe that failed during a daemon outage', async () => {
    // Regression: onboarding's ungated ensure ran while the daemon was down,
    // poisoning state with checked=true, ok=false, hasCheckedOnce=true. On
    // recovery this component must re-probe instead of toasting stale state.
    mocks.daemonHealth.value = 'down';
    mocks.hostRequirements.value = stateWithNode({ checked: true, ok: false });
    render(NodeVersionToast);
    await tick();
    expect(mocks.toastWarning).not.toHaveBeenCalled();

    mocks.daemonHealth.value = 'healthy';
    emitState();
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'hostRequirements/checkHostRequirementsRequested' }),
      ),
    );
    // Stale ok:false is still in state, but the fresh probe has not settled.
    expect(mocks.toastWarning).not.toHaveBeenCalled();

    await settleProbe({ checked: true, ok: true, version: '22.4.0' });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 *
 * NodeVersionToast — once-per-session Node.js requirement warning in the
 * (app) shell. Covers: the toast fires for an unmet node requirement outside
 * onboarding (once per session, across remounts), stays quiet during
 * onboarding (/workspace/new), before the probe settles, and when the
 * requirement is met, and the daemon-health-gated ensure dispatch.
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
  const route: { params: Record<string, string> } = { params: {} };
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
    subscribe: (run: (value: { params: Record<string, string> }) => void) => {
      run({ params: mocks.route.params });
      return () => {};
    },
  },
}));

vi.mock('svelte-sonner', () => ({
  toast: { warning: mocks.toastWarning },
}));

import NodeVersionToast, {
  resetNodeVersionToastSessionLatch,
} from './NodeVersionToast.svelte';

const stateWithNode = (node: HostRequirementsState['node']): HostRequirementsState => ({
  git: { checked: true, available: true, version: '2.44.0' },
  node,
  gh: { checked: true, available: true, version: '2.62.0' },
  checking: false,
  hasCheckedOnce: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetNodeVersionToastSessionLatch();
  mocks.route.params = {};
  mocks.daemonHealth.value = 'healthy';
  mocks.hostRequirements.value = stateWithNode({ checked: true, ok: true, version: '22.4.0' });
});

describe('NodeVersionToast', () => {
  it('warns once when the node requirement is unmet outside onboarding', async () => {
    mocks.hostRequirements.value = stateWithNode({ checked: true, ok: false, version: '18.19.0' });
    render(NodeVersionToast);
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      m.lib_nodeVersionWarning_haveVersion_message({
        minimumVersion: MINIMUM_NODE_VERSION,
        nodeVersion: '18.19.0',
      }),
    );
  });

  it('uses the not-found copy when no node version was probed', async () => {
    mocks.hostRequirements.value = stateWithNode({ checked: true, ok: false });
    render(NodeVersionToast);
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      m.lib_nodeVersionWarning_notFound_message({ minimumVersion: MINIMUM_NODE_VERSION }),
    );
  });

  it('fires only once per session, even across remounts', async () => {
    mocks.hostRequirements.value = stateWithNode({ checked: true, ok: false, version: '18.19.0' });
    const first = render(NodeVersionToast);
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    first.unmount();
    render(NodeVersionToast);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
  });

  it('stays quiet during onboarding (/workspace/new)', async () => {
    mocks.route.params = { id: 'new' };
    mocks.hostRequirements.value = stateWithNode({ checked: true, ok: false, version: '18.19.0' });
    render(NodeVersionToast);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('stays quiet before the node probe settles and when the requirement is met', async () => {
    mocks.hostRequirements.value = stateWithNode({ checked: false, ok: false });
    const pending = render(NodeVersionToast);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    pending.unmount();

    mocks.hostRequirements.value = stateWithNode({ checked: true, ok: true, version: '22.4.0' });
    render(NodeVersionToast);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('ensures the requirements check once the daemon is healthy — not before', async () => {
    mocks.daemonHealth.value = 'down';
    render(NodeVersionToast);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.dispatch).not.toHaveBeenCalled();

    mocks.daemonHealth.value = 'healthy';
    render(NodeVersionToast);
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'hostRequirements/ensureHostRequirementsChecked' }),
      ),
    );
  });
});

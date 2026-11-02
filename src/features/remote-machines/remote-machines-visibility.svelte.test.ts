/**
 * @vitest-environment jsdom
 *
 * Remote machines show only while the Labs flag is on AND the current backend
 * advertises `remoteMachines: 1`. Turning the flag off hides every surface
 * without revoking anything.
 */
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { ExecutorBackend, RemoteMachine } from '$shared/types/remote-machines';
import BackendsWithAccessSection from './BackendsWithAccessSection.svelte';
import RemoteMachinesSection from './RemoteMachinesSection.svelte';
import { remoteMachinesLoaded } from './remote-machines-slice';
import { selectRemoteMachinesVisible } from './remote-machines-selectors';

const MACHINE: RemoteMachine = {
  id: 'd-mac',
  name: 'Studio Mac',
  hosts: ['192.0.2.4'],
  port: 5179,
  fingerprint: 'AA:BB',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-11-01T00:00:00Z',
};
const BACKEND: ExecutorBackend = {
  credentialId: 'cred-1',
  backendId: 'head-1',
  backendName: 'Build box',
  createdAt: '2026-11-01T00:00:00Z',
  connected: false,
  runningAgents: 0,
};

function seed(labs: boolean, supported: boolean) {
  store.dispatch(setLabsRemoteAgentsEnabled(labs));
  store.dispatch(
    remoteMachinesLoaded({
      supported,
      machines: [MACHINE],
      localFingerprint: null,
      executorBackends: [BACKEND],
    }),
  );
}

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
});

describe.each([
  { labs: true, supported: true, visible: true },
  { labs: true, supported: false, visible: false },
  { labs: false, supported: true, visible: false },
  { labs: false, supported: false, visible: false },
])('labs $labs × remoteMachines $supported', ({ labs, supported, visible }) => {
  it(`is ${visible ? 'visible' : 'hidden'}`, () => {
    seed(labs, supported);
    expect(selectRemoteMachinesVisible.select(store.state)).toBe(visible);
    const machines = render(RemoteMachinesSection);
    const backends = render(BackendsWithAccessSection);
    expect(machines.queryByText('Studio Mac') !== null).toBe(visible);
    expect(backends.queryByText('Build box') !== null).toBe(visible);
  });
});

it('hides on flag off without dropping the saved machines (nothing is revoked)', () => {
  seed(true, true);
  store.dispatch(setLabsRemoteAgentsEnabled(false));
  expect(selectRemoteMachinesVisible.select(store.state)).toBe(false);
  expect(store.state.remoteMachines.machines['d-mac']).toBeDefined();
});

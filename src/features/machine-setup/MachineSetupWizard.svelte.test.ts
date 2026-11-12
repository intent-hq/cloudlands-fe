/**
 * @vitest-environment jsdom
 *
 * The Set up a new machine wizard: which cards it offers, and the accent a
 * new machine gets on Enter connection details.
 */
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import MachineSetupWizard from './MachineSetupWizard.svelte';
import { machineSetupClosed, machineSetupOpened } from './machine-setup-slice';

const remote = (id: string): ConnectionRecord => ({
  id,
  label: id,
  host: '192.0.2.10',
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
});

function seed({ remotes = 0, nodes = false } = {}) {
  store.dispatch(
    connectionsListReceived({
      connections: Array.from({ length: remotes }, (_, i) => remote(`remote-${i}`)),
      activeId: null,
      windowBackendId: null,
    }),
  );
  store.dispatch(setLabsRemoteAgentsEnabled(nodes));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
}

beforeEach(() => store.init());
afterEach(() => store.dispatch(machineSetupClosed()));

const card = (id: string) => document.querySelector(`[data-machine-setup-card="${id}"]`);

describe('Set up a new machine', () => {
  it.each([
    [false, false],
    [true, true],
  ])('with Remote agents %s, offers Install a node: %s', async (nodes, offered) => {
    seed({ nodes });
    store.dispatch(machineSetupOpened());
    render(MachineSetupWizard);
    await screen.findByRole('dialog');
    expect(card('paste')).not.toBeNull();
    expect(card('backend')).not.toBeNull();
    expect(card('node') !== null).toBe(offered);
  });

  it('gives a new machine the next selectable accent', async () => {
    seed({ remotes: 3 });
    store.dispatch(machineSetupOpened('details'));
    render(MachineSetupWizard);
    const teal = await screen.findByRole('button', { name: 'Use Teal accent' });
    expect(teal.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Use Rose accent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use Orange accent' })).toBeNull();
  });
});

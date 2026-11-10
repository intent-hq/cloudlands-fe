/**
 * @vitest-environment jsdom
 *
 * A machine's ⋮ menu marks only Remove as destructive. Stopping the current
 * backend from running agents on the machine is reversible, so it uses the
 * neutral style and names the machine explicitly.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { store } from '$store/renderer/store';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import RemoteMachinesSection from '$features/remote-machines/RemoteMachinesSection.svelte';
import DeviceRow from '../DeviceRow.svelte';

const DEVICE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.2',
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
  status: 'not-open',
};

const MACHINE: RemoteMachine = {
  id: 'd-mac',
  name: 'Studio Mac',
  hosts: ['10.0.0.2'],
  port: 5181,
  fingerprint: 'AA:BB',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-11-01T00:00:00Z',
};

const STOP_LABEL = /^Stop letting .+ run agents on this machine$/;

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  // Saved here: a machine this app has no connection to is listed under Nodes.
  store.dispatch(
    connectionsListReceived({ connections: [DEVICE], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [MACHINE],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
});

function menuItems() {
  return screen.getAllByRole('menuitem').map((item) => ({
    label: item.textContent?.trim() ?? '',
    destructive: item.hasAttribute('data-destructive'),
  }));
}

describe('machine row menu', () => {
  it('marks only Remove as destructive and words the stop action for this machine', async () => {
    render(DeviceRow, {
      props: {
        device: DEVICE,
        panelMode: null,
        onOpenPanel: () => {},
        onClosePanel: () => {},
        onRequestRemove: () => {},
      },
    });
    await fireEvent.click(
      screen.getByRole('button', {
        name: m.settings_devices_actionsFor_ariaLabel({ name: 'Studio Mac' }),
      }),
    );

    const items = menuItems();
    expect(items.filter((item) => item.destructive).map((item) => item.label)).toEqual([
      m.settings_devices_remove_label(),
    ]);
    const stop = items.find((item) => STOP_LABEL.test(item.label));
    expect(stop?.destructive).toBe(false);
  });

  it('uses the same neutral wording in the remote machines list', async () => {
    render(RemoteMachinesSection);
    await fireEvent.click(
      screen.getByRole('button', {
        name: m.remoteMachines_actionsFor_ariaLabel({ name: 'Studio Mac' }),
      }),
    );

    const items = menuItems();
    expect(items).toHaveLength(1);
    expect(items[0].label).toMatch(STOP_LABEL);
    expect(items[0].destructive).toBe(false);
  });
});

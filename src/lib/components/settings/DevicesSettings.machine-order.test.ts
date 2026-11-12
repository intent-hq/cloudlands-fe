/**
 * @vitest-environment jsdom
 *
 * Settings → Machines against a backend with `machineOrder: 1` (PROTOCOL
 * `methods/nodes.md` → "Ordered machine list" and "One ordered list"): one
 * list in the stored order replaces Nodes and "Machines <backend> can run
 * agents on"; the owner moves rows with the row menu's Move up / Move down,
 * members read it, live `remoteMachine:changed { order }` events reorder it,
 * and an older backend keeps today's sections.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';
import type { MachineOrderRow, RemoteMachine } from '$shared/types/remote-machines';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  machineOrderSetRequested,
  remoteMachinesLoaded,
} from '$features/remote-machines/remote-machines-slice';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';

vi.mock('$lib/client', () => ({
  localMachineClient: {
    settings: { list: vi.fn(async () => []), update: vi.fn() },
    server: { pairingInfo: vi.fn(async () => null), rotateToken: vi.fn() },
  },
  appClient: {
    settings: { list: vi.fn(async () => []), update: vi.fn() },
    server: { pairingInfo: vi.fn(async () => null), rotateToken: vi.fn() },
  },
}));
vi.mock('$features/settings/settings-hydration-service', () => ({ applySettingsChanges: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import DevicesSettings from './DevicesSettings.svelte';

const local: ConnectionRecord = {
  id: 'local',
  label: 'This machine',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
  status: 'connected',
};
/** A saved full daemon that is exposed to the backend. */
const studio: ConnectionRecord = {
  id: 'studio',
  label: 'Studio Mac',
  host: '10.0.0.2',
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
  status: 'not-open',
};
/** A saved full daemon that is not exposed: it stays in the Machines list. */
const spare: ConnectionRecord = {
  id: 'spare',
  label: 'Spare box',
  host: '10.0.0.3',
  port: 5181,
  fingerprint: 'EE:FF',
  isLocal: false,
  status: 'not-open',
};

function machine(id: string, name: string, fingerprint: string): RemoteMachine {
  return {
    id,
    name,
    hosts: ['10.0.0.9'],
    port: 5181,
    fingerprint,
    state: 'connected',
    runningAgents: 0,
    addedAt: '2026-11-01T00:00:00Z',
  };
}

const STUDIO = machine('d-studio', 'Studio Mac', 'AA:BB');
/** Added from an intent://node link: no saved connection here. */
const GARAGE = machine('d-garage', 'Garage node', '11:22');

const ORDER: MachineOrderRow[] = [
  { kind: 'machine', nodeId: 'd-garage', name: 'Garage node' },
  { kind: 'local', name: 'build-host' },
  { kind: 'machine', nodeId: 'd-studio', name: 'Studio Mac' },
  { kind: 'cloud', cloudMachineId: 'e2b-main', name: 'Main sandbox' },
];

function seed({
  machineOrder = true,
  order = ORDER,
}: { machineOrder?: boolean; order?: MachineOrderRow[] } = {}) {
  store.dispatch(
    connectionsListReceived({
      connections: [local, studio, spare],
      activeId: 'local',
      windowBackendId: 'local',
    }),
  );
  admitLegacyPrincipal();
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machineOrder,
      order: machineOrder ? order : null,
      machines: [STUDIO, GARAGE],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
}

function asMember() {
  const { context, invalidation, presentationVersion } = store.state.principal;
  store.dispatch(
    principalReceived(
      { context: context!, invalidation, presentationVersion },
      withHostPrincipal(store.state, 'member').principal.snapshot!,
    ),
  );
}

function orderedSection() {
  return screen.getByRole('region', {
    name: m.remoteMachines_order_title({ backend: m.layout_daemonStatus_localConnection_label() }),
  });
}

/** The row ids of the ordered list, top to bottom. */
function orderedIds() {
  return Array.from(orderedSection().querySelectorAll('[data-machine-order-row]')).map((row) =>
    row.getAttribute('data-machine-order-row'),
  );
}

function orderedRow(id: string) {
  return orderedSection().querySelector<HTMLElement>(`[data-machine-order-row="${id}"]`)!;
}

async function openMenu(row: HTMLElement) {
  await fireEvent.click(within(row).getAllByRole('button', { name: /./ }).at(-1)!);
}

let dispatch: ReturnType<typeof vi.spyOn<typeof store, 'dispatch'>>;

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  dispatch = vi.spyOn(store, 'dispatch');
});

afterEach(() => {
  cleanup();
  dispatch.mockRestore();
});

describe('Settings → Machines with machineOrder: 1', () => {
  it('lists every row in the stored order and marks only the first as preferred', () => {
    seed();
    render(DevicesSettings);

    expect(orderedIds()).toEqual([
      'machine:d-garage',
      'local',
      'machine:d-studio',
      'cloud:e2b-main',
    ]);
    const preferred = orderedSection().querySelectorAll('[data-preferred-machine]');
    expect(preferred).toHaveLength(1);
    expect(orderedRow('machine:d-garage').contains(preferred[0])).toBe(true);
    // Merged: no separate Nodes or "can run agents on" section.
    expect(document.querySelector('[data-nodes-section]')).toBeNull();
    expect(
      screen.queryByRole('heading', {
        name: m.remoteMachines_section_title({
          backend: m.layout_daemonStatus_localConnection_label(),
        }),
      }),
    ).toBeNull();
  });

  it('keeps saved full daemons that are not exposed in the Machines list above', () => {
    seed();
    render(DevicesSettings);

    const machines = screen.getByRole('list', { name: m.settings_devices_title() });
    expect(within(machines).queryByRole('article', { name: 'Spare box' })).not.toBeNull();
    expect(within(machines).queryByRole('article', { name: 'Studio Mac' })).toBeNull();
    expect(
      within(orderedRow('machine:d-studio')).getByRole('article', { name: 'Studio Mac' }),
    ).toBeTruthy();
  });

  it('Move down sends the whole list with the row one place lower', async () => {
    seed();
    render(DevicesSettings);

    await openMenu(orderedRow('machine:d-garage'));
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.remoteMachines_order_moveDown_label() }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      machineOrderSetRequested([
        { kind: 'local' },
        { kind: 'machine', nodeId: 'd-garage' },
        { kind: 'machine', nodeId: 'd-studio' },
        { kind: 'cloud', cloudMachineId: 'e2b-main' },
      ]),
    );
  });

  it('Move up sends the whole list with the row one place higher', async () => {
    seed();
    render(DevicesSettings);

    await openMenu(orderedRow('cloud:e2b-main'));
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.remoteMachines_order_moveUp_label() }),
    );

    expect(dispatch).toHaveBeenCalledWith(
      machineOrderSetRequested([
        { kind: 'machine', nodeId: 'd-garage' },
        { kind: 'local' },
        { kind: 'cloud', cloudMachineId: 'e2b-main' },
        { kind: 'machine', nodeId: 'd-studio' },
      ]),
    );
  });

  it('disables Move up on the first row and Move down on the last', async () => {
    seed();
    render(DevicesSettings);
    const disabled = (name: string) =>
      screen.getByRole('menuitem', { name }).getAttribute('aria-disabled') === 'true' ||
      screen.getByRole('menuitem', { name }).hasAttribute('data-disabled');

    await openMenu(orderedRow('machine:d-garage'));
    expect(disabled(m.remoteMachines_order_moveUp_label())).toBe(true);
    expect(disabled(m.remoteMachines_order_moveDown_label())).toBe(false);
    cleanup();

    render(DevicesSettings);
    await openMenu(orderedRow('cloud:e2b-main'));
    expect(disabled(m.remoteMachines_order_moveUp_label())).toBe(false);
    expect(disabled(m.remoteMachines_order_moveDown_label())).toBe(true);
  });

  it('shows members the list read-only', async () => {
    seed();
    asMember();
    render(DevicesSettings);

    expect(orderedIds()).toEqual([
      'machine:d-garage',
      'local',
      'machine:d-studio',
      'cloud:e2b-main',
    ]);
    expect(orderedSection().querySelector('[data-machine-order-handle]')).toBeNull();
    await openMenu(orderedRow('machine:d-garage'));
    expect(
      screen.queryByRole('menuitem', { name: m.remoteMachines_order_moveUp_label() }),
    ).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: m.remoteMachines_order_moveDown_label() }),
    ).toBeNull();
  });

  it('reorders live from remoteMachine:changed { order }', async () => {
    seed();
    render(DevicesSettings);

    routeDaemonEventsNotification('events.event', {
      event: {
        type: 'remoteMachine:changed',
        data: { order: [ORDER[2], ORDER[3], ORDER[0], ORDER[1]] },
      },
    });

    await vi.waitFor(() =>
      expect(orderedIds()).toEqual([
        'machine:d-studio',
        'cloud:e2b-main',
        'machine:d-garage',
        'local',
      ]),
    );
    // A machine payload without `order` leaves the list as it is.
    routeDaemonEventsNotification('events.event', {
      event: { type: 'remoteMachine:changed', data: { machine: { ...GARAGE, runningAgents: 2 } } },
    });
    expect(orderedIds()).toEqual([
      'machine:d-studio',
      'cloud:e2b-main',
      'machine:d-garage',
      'local',
    ]);
  });

  it('keeps the older sections on a backend without machineOrder: 1', () => {
    seed({ machineOrder: false });
    render(DevicesSettings);

    expect(document.querySelector('[data-machine-order-section]')).toBeNull();
    expect(document.querySelector('[data-nodes-section]')).not.toBeNull();
    expect(
      screen.getByRole('heading', {
        name: m.remoteMachines_section_title({
          backend: m.layout_daemonStatus_localConnection_label(),
        }),
      }),
    ).toBeTruthy();
  });
});

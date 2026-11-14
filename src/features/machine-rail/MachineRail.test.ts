/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { MachineRailState } from '$shared/types/machine-rail';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  navigateToSettings: vi.fn(async () => {}),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
});
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: mocks.navigateToSettings,
}));
vi.mock('$lib/components/layout/DaemonStatusIndicator.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/layout/ConnectBackendModal.svelte', () => ({ default: () => null }));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import MachineRail from './MachineRail.svelte';

function record(id: string, status: ConnectionRecord['status'] = 'connected'): ConnectionRecord {
  return {
    id,
    label: id,
    host: id === 'local' ? null : '10.0.0.1',
    port: id === 'local' ? null : 5181,
    fingerprint: null,
    isLocal: id === 'local',
    status,
  };
}

function guest(id: string): GuestSessionRecord {
  return { id, label: `${id}.example:5181`, hostname: id } as GuestSessionRecord;
}

function setState(rail: Partial<MachineRailState>) {
  mocks.state = {
    machineRail: {
      enabled: true,
      homeId: 'local',
      machineIds: ['local', 'g1', 'b'],
      selectedId: 'local',
      shownId: 'local',
      pendingId: '',
      degradedIds: [],
      ...rail,
    },
    connections: {
      windowBackendId: 'local',
      connections: createCollection<ConnectionRecord, 'id'>('id', [
        record('local'),
        record('b', 'disconnected'),
      ]),
    },
    guestSessions: {
      sessions: createCollection<GuestSessionRecord, 'id'>('id', [guest('g1'), guest('g2')]),
      connectedIds: ['g1'],
    },
    userPreferences: {},
  };
}

const railItems = () => screen.getAllByTestId('machine-rail-item');

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.navigateToSettings.mockClear();
  setState({});
});

afterEach(() => cleanup());

it('lists guest hosts after your own machines, below a separator', () => {
  render(MachineRail);
  expect(railItems().map((item) => item.dataset.machineId)).toEqual(['local', 'b', 'g1']);
  const separator = screen.getByTestId('machine-rail-guest-separator');
  const guestItem = railItems()[2];
  expect(
    separator.compareDocumentPosition(guestItem) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it('has no separator without a guest host in the rail', () => {
  setState({ machineIds: ['local', 'b'] });
  render(MachineRail);
  expect(screen.queryByTestId('machine-rail-guest-separator')).toBeNull();
});

it('opens a machine menu on a context click without switching to that machine', async () => {
  render(MachineRail);
  const [, build] = railItems();
  await fireEvent.contextMenu(build);
  const menu = await screen.findByTestId('machine-rail-item-menu');
  expect(within(menu).getByTestId('machine-rail-menu-status')).toBeTruthy();
  expect(mocks.dispatch).not.toHaveBeenCalled();

  await fireEvent.click(within(menu).getByTestId('machine-rail-menu-remove'));
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'machineRail/removeRequested', payload: ['b'] }),
  );
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
});

function withUpdatableB(workflows: unknown[] = []) {
  const connections = mocks.state.connections as Record<string, unknown>;
  mocks.state = {
    ...mocks.state,
    connections: {
      ...connections,
      pinnedVersion: '0.10.0',
      connectedIds: ['local', 'b'],
      connections: createCollection<ConnectionRecord, 'id'>('id', [
        record('local'),
        { ...record('b'), daemonVersion: '0.9.0', updateSupported: true },
      ]),
      workflows: createCollection('id', workflows as never[]),
    },
  };
}

it('offers to update a machine whose daemon can be updated, from its menu', async () => {
  withUpdatableB();
  render(MachineRail);
  await fireEvent.contextMenu(railItems()[1]);
  const menu = await screen.findByTestId('machine-rail-item-menu');
  await fireEvent.click(within(menu).getByTestId('machine-rail-menu-update'));
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'connections/workflowRequested',
      payload: expect.objectContaining({
        consumerId: 'machine-rail:update:b',
        intent: { kind: 'updateBackend', id: 'b' },
      }),
    }),
  );
  cleanup();

  // A guest host is never offered an update.
  render(MachineRail);
  await fireEvent.contextMenu(railItems()[2]);
  const guestMenu = await screen.findByTestId('machine-rail-item-menu');
  expect(within(guestMenu).queryByTestId('machine-rail-menu-update')).toBeNull();
});

it('does not start a second update while one runs', async () => {
  withUpdatableB([
    {
      id: 'machine-rail:update:b',
      requestId: 'r1',
      targetId: 'b',
      kind: 'updateBackend',
      phase: 'running',
      secretReplaced: false,
      outcome: null,
    },
  ]);
  render(MachineRail);
  await fireEvent.contextMenu(railItems()[1]);
  const menu = await screen.findByTestId('machine-rail-item-menu');
  const update = within(menu).getByTestId('machine-rail-menu-update');
  expect(update.getAttribute('aria-disabled')).toBe('true');
  await fireEvent.click(update);
  expect(mocks.dispatch).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'connections/workflowRequested' }),
  );
});

it("sends a guest host's manage action to the guest session settings", async () => {
  render(MachineRail);
  await fireEvent.contextMenu(railItems()[2]);
  const menu = await screen.findByTestId('machine-rail-item-menu');
  await fireEvent.click(within(menu).getByTestId('machine-rail-menu-manage'));
  await waitFor(() =>
    expect(mocks.navigateToSettings).toHaveBeenCalledWith({ tab: 'collaboration' }),
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it('marks a machine that is still starting as busy', () => {
  setState({ pendingId: 'b' });
  render(MachineRail);
  const [, build] = railItems();
  expect(build.getAttribute('aria-busy')).toBe('true');
  expect(railItems()[0].getAttribute('aria-busy')).toBeNull();
});

it('marks the machines that are not connected', () => {
  render(MachineRail);
  expect(railItems().map((item) => item.dataset.offline === 'true')).toEqual([false, true, false]);
});

it('marks a connected machine whose daemon is degraded', () => {
  setState({ degradedIds: ['local', 'b'] });
  render(MachineRail);
  // `b` is offline, so only the connected degraded machine gets the warning dot.
  expect(
    screen.getAllByTestId('machine-rail-degraded-dot').map((dot) => dot.dataset.machineId),
  ).toEqual(['local']);
});

it('marks a machine whose daemon can be updated, except while it starts', () => {
  const connections = mocks.state.connections as Record<string, unknown>;
  const behind = { daemonVersion: '0.9.0', updateSupported: true };
  mocks.state = {
    ...mocks.state,
    connections: {
      ...connections,
      pinnedVersion: '0.10.0',
      connectedIds: ['local', 'b'],
      connections: createCollection<ConnectionRecord, 'id'>('id', [
        { ...record('local'), ...behind },
        { ...record('b'), ...behind },
      ]),
    },
  };
  render(MachineRail);
  expect(
    screen.getAllByTestId('machine-rail-update-dot').map((dot) => dot.dataset.machineId),
  ).toEqual(['local', 'b']);
  cleanup();

  mocks.state = {
    ...mocks.state,
    machineRail: { ...(mocks.state.machineRail as object), pendingId: 'b' },
  };
  render(MachineRail);
  expect(
    screen.getAllByTestId('machine-rail-update-dot').map((dot) => dot.dataset.machineId),
  ).toEqual(['local']);
});

it("moves a machine with Alt+arrow keys, keeping the window's own machine first", async () => {
  setState({ machineIds: ['local', 'b', 'c', 'g1'] });
  mocks.state = {
    ...mocks.state,
    connections: {
      ...(mocks.state.connections as object),
      connections: createCollection<ConnectionRecord, 'id'>('id', [
        record('local'),
        record('b'),
        record('c'),
      ]),
    },
  };
  render(MachineRail);
  const [local, , c] = railItems();
  c.focus();
  await fireEvent.keyDown(c, { key: 'ArrowUp', altKey: true });
  // The moved machine keeps keyboard focus, so it can be moved again.
  await waitFor(() =>
    expect((document.activeElement as HTMLElement | null)?.dataset.machineId).toBe('c'),
  );
  expect(mocks.dispatch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'machineRail/reorderRequested',
      payload: [['local', 'c', 'b', 'g1']],
    }),
  );
  mocks.dispatch.mockClear();
  // The new order shows at once: `c` is now right below the window's own machine.
  expect(railItems().map((item) => item.dataset.machineId)).toEqual(['local', 'c', 'b', 'g1']);
  await fireEvent.keyDown(c, { key: 'ArrowUp', altKey: true });
  await fireEvent.keyDown(local, { key: 'ArrowDown', altKey: true });
  expect(mocks.dispatch).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'machineRail/reorderRequested' }),
  );
});

it('offers guest hosts that are not in the rail in the add menu', async () => {
  render(MachineRail);
  await fireEvent.pointerDown(screen.getByTestId('machine-rail-add'), { button: 0 });
  await fireEvent.click(screen.getByTestId('machine-rail-add'));
  const candidates = await screen.findAllByTestId('machine-rail-add-item');
  expect(candidates.map((item) => item.dataset.machineId)).toEqual(['g2']);
});

it("lists every machine but the window's own for removal in the add menu, and removes the picked one", async () => {
  render(MachineRail);
  await fireEvent.pointerDown(screen.getByTestId('machine-rail-add'), { button: 0 });
  await fireEvent.click(screen.getByTestId('machine-rail-add'));
  const removable = await screen.findAllByTestId('machine-rail-remove-item');
  expect(removable.map((item) => item.dataset.machineId)).toEqual(['b', 'g1']);

  await fireEvent.click(removable[0]);
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'machineRail/removeRequested', payload: ['b'] }),
  );
});

it('offers nothing to remove when the rail holds only the window machine', async () => {
  setState({ machineIds: ['local'] });
  render(MachineRail);
  await fireEvent.pointerDown(screen.getByTestId('machine-rail-add'), { button: 0 });
  await fireEvent.click(screen.getByTestId('machine-rail-add'));
  await screen.findByTestId('machine-rail-add-new');
  expect(screen.queryAllByTestId('machine-rail-remove-item')).toEqual([]);
});

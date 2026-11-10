import { describe, expect, it } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import { unifiedTabKey } from '../unified-window-state';
import {
  buildUnifiedMachines,
  feedEntities,
  recordFromTabState,
  shellSelection,
  tabsByMachine,
  tabStateFromRecord,
  tabsToCloseForDeletedWorkspaces,
} from './unified-shell-model';

const connection = (overrides: Partial<ConnectionRecord>): ConnectionRecord => ({
  id: 'x',
  label: 'X',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: false,
  status: 'connected',
  ...overrides,
});

const guest = {
  id: 'guest-1',
  label: 'ana.tc.example',
  hostname: 'Ana’s MacBook Pro',
} as GuestSessionRecord;

describe('buildUnifiedMachines', () => {
  const machines = buildUnifiedMachines({
    connections: [
      connection({ id: 'local', isLocal: true, machineName: 'Studio' }),
      connection({ id: 'studio', label: 'Mac Studio', accent: 'violet' }),
      connection({ id: 'node-1', label: 'GPU node', daemonMode: 'node' }),
      connection({ id: 'box', label: 'Build box', accent: null }),
    ],
    connectedIds: ['local', 'studio'],
    guestSessions: [guest],
    guestConnectedIds: [],
  });

  it('lists local first, then saved remotes, then guest hosts, never remote nodes', () => {
    expect(machines.map((machine) => [machine.id, machine.kind])).toEqual([
      ['local', 'local'],
      ['studio', 'remote'],
      ['box', 'remote'],
      ['guest-1', 'guest'],
    ]);
  });

  it('marks connected machines online and keeps accents for remotes only', () => {
    expect(machines.map((machine) => [machine.id, machine.online, machine.accent])).toEqual([
      ['local', true, null],
      ['studio', true, 'violet'],
      ['box', false, null],
      ['guest-1', false, null],
    ]);
    expect(machines[3].label).toBe('Ana’s MacBook Pro');
  });
});

describe('feed and tabs', () => {
  const feeds = [
    { machineId: 'local', stale: false, rows: [{ id: 'w1', title: 'Same id' }] },
    { machineId: 'studio', stale: true, rows: [{ id: 'w1', title: 'Same id, other machine' }] },
  ];

  it('keys every workspace entity by (machine, workspace) so equal ids stay distinct', () => {
    expect(feedEntities(feeds).map((entity) => [entity.id, entity.title])).toEqual([
      [unifiedTabKey('local', 'w1'), 'Same id'],
      [unifiedTabKey('studio', 'w1'), 'Same id, other machine'],
    ]);
  });

  it('groups open tab keys by machine for the views', () => {
    expect(
      tabsByMachine([
        unifiedTabKey('local', 'w1'),
        unifiedTabKey('studio', 'w2'),
        unifiedTabKey('local', 'w3'),
        'garbage',
      ]),
    ).toEqual({ local: ['w1', 'w3'], studio: ['w2'] });
  });

  it('closes tabs of deleted workspaces only when the machine list is fresh', () => {
    const open = [
      unifiedTabKey('local', 'w1'),
      unifiedTabKey('local', 'deleted'),
      unifiedTabKey('studio', 'gone-while-offline'),
      unifiedTabKey('guest', 'never-loaded'),
    ];
    expect(tabsToCloseForDeletedWorkspaces(open, feeds)).toEqual([unifiedTabKey('local', 'deleted')]);
  });
});

describe('shellSelection', () => {
  const machines = buildUnifiedMachines({
    connections: [
      connection({ id: 'local', isLocal: true }),
      connection({ id: 'studio', label: 'Mac Studio' }),
    ],
    connectedIds: ['local'],
    guestSessions: [],
    guestConnectedIds: [],
  });

  it('shows Home or Settings on the dropdown machine when no tab is selected', () => {
    expect(shellSelection(null, 'home', 'studio', machines)).toEqual({
      kind: 'view',
      machineId: 'studio',
      route: '/',
    });
    expect(shellSelection(null, 'settings', 'local', machines)).toEqual({
      kind: 'view',
      machineId: 'local',
      route: '/settings',
    });
  });

  it("shows a tab in its own machine's view, whatever the dropdown machine is", () => {
    expect(shellSelection(unifiedTabKey('local', 'w 1'), 'home', 'studio', machines)).toEqual({
      kind: 'view',
      machineId: 'local',
      route: '/workspace/w%201',
    });
  });

  it('shows the offline message for a tab whose machine is offline', () => {
    expect(shellSelection(unifiedTabKey('studio', 'w2'), 'home', 'local', machines)).toMatchObject({
      kind: 'offline',
      machine: { id: 'studio' },
    });
  });
});

describe('restore record', () => {
  it('round-trips tabs, pins, groups, active tab and dropdown machine', () => {
    const a = unifiedTabKey('local', 'w1');
    const b = unifiedTabKey('studio', 'w2');
    const record = recordFromTabState(
      {
        openTabs: [a, b],
        currentTabId: b,
        pinnedTabs: [b],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: [b, a],
        tabGroups: [{ id: 'g', name: 'Release', color: 'blue', workspaceIds: [b, a] }],
        openTabGroupId: 'g',
      },
      'studio',
    );
    expect(record).toEqual({
      version: 1,
      tabKeys: [b, a],
      pinnedTabKeys: [b],
      activeTabKey: b,
      groups: [{ id: 'g', name: 'Release', color: 'blue', tabKeys: [b, a] }],
      openGroupId: 'g',
      dropdownMachineId: 'studio',
    });
    expect(tabStateFromRecord(record)).toMatchObject({
      openTabs: [b, a],
      tabOrder: [b, a],
      currentTabId: b,
      pinnedTabs: [b],
      tabGroups: [{ id: 'g', name: 'Release', color: 'blue', workspaceIds: [b, a] }],
      openTabGroupId: 'g',
    });
  });
});

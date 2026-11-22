/**
 * Start On against an orchestrator (PROTOCOL `methods/nodes.md` →
 * "Orchestrator mode" and "One ordered list"): the backend never runs agents,
 * so it has no row and there is no "First available" choice. The runners
 * follow the stored order and the first usable one is preselected. An omitted
 * placement still walks the order for API callers. A Full backend keeps its own row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionRecord, DaemonMode } from '$shared/types/connections';
import type { MachineOrderRow, RemoteMachine } from '$shared/types/remote-machines';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { remoteMachinesLoaded } from './remote-machines-slice';
import {
  selectEffectiveStartOn,
  selectStartOnOptions,
  selectStartOnRows,
} from './remote-machines-selectors';
import {
  initialAgentPlacement,
  START_ON_BACKEND,
  START_ON_HOST,
  startOnBackendLabel,
  startOnDefault,
  startOnModelMachineId,
} from './start-on';

const backend: ConnectionRecord = {
  id: 'hub',
  label: 'Hub server',
  host: '192.0.2.1',
  port: 5179,
  fingerprint: 'AA:01',
  isLocal: false,
  status: 'connected',
  hostOs: 'linux',
  hostArch: 'x86_64',
};

function machine(id: string, name: string, state: RemoteMachine['state'] = 'connected') {
  return {
    id,
    name,
    platform: { os: 'macos', arch: 'aarch64' },
    hosts: [],
    port: 5179,
    fingerprint: `FP:${id}`,
    state,
    runningAgents: 0,
    addedAt: '2026-11-01T00:00:00Z',
  } satisfies RemoteMachine;
}

function seed(daemonMode: DaemonMode | undefined, order: MachineOrderRow[]) {
  store.dispatch(
    connectionsListReceived({
      connections: [backend],
      activeId: backend.id,
      windowBackendId: backend.id,
    }),
  );
  admitLegacyPrincipal('owner', {}, daemonMode);
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      initialAgentPlacement: true,
      machineOrder: true,
      order,
      localFingerprint: null,
      executorBackends: null,
      machines: [machine('d-mac', 'Mac Studio'), machine('d-pc', 'Gaming PC')],
    }),
  );
}

/** An orchestrator's list never has a "This computer" row. */
const ORCHESTRATOR_ORDER: MachineOrderRow[] = [
  { kind: 'machine', nodeId: 'd-pc', name: 'Gaming PC' },
  { kind: 'machine', nodeId: 'd-mac', name: 'Mac Studio' },
];

beforeEach(() => store.init());
afterEach(() => store.dispose());

describe('Start On on an orchestrator', () => {
  it('offers only the runners, in order, with no backend or First available row', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    const options = selectStartOnOptions.select(store.state);

    expect(options.map((option) => option.id)).toEqual(['d-pc', 'd-mac']);
    expect(options.map((option) => option.label)).not.toContain(backend.label);
    // Messages that name the host fall back to its name.
    expect(startOnBackendLabel(options, backend.label)).toBe(backend.label);
  });

  it('preselects the first runner in order and sends it as the placement', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    for (const remembered of [undefined, START_ON_BACKEND, 'd-gone']) {
      const effective = selectEffectiveStartOn.select(store.state, remembered);
      expect(effective).toBe('d-pc');
      expect(initialAgentPlacement(effective)).toEqual({
        target: 'remote',
        checkout: 'isolated',
        nodeId: 'd-pc',
      });
    }
    // A runner the user chose stays chosen.
    expect(selectEffectiveStartOn.select(store.state, 'd-mac')).toBe('d-mac');
  });

  it('preselects the first online runner when the first one is offline', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        initialAgentPlacement: true,
        machineOrder: true,
        order: ORCHESTRATOR_ORDER,
        localFingerprint: null,
        executorBackends: null,
        machines: [machine('d-mac', 'Mac Studio'), machine('d-pc', 'Gaming PC', 'unreachable')],
      }),
    );
    expect(selectEffectiveStartOn.select(store.state, undefined)).toBe('d-mac');
  });

  it('keeps the first runner chosen when none can take the agent, so the picker says why', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        initialAgentPlacement: true,
        machineOrder: true,
        order: ORCHESTRATOR_ORDER,
        localFingerprint: null,
        executorBackends: null,
        machines: [
          machine('d-mac', 'Mac Studio', 'unreachable'),
          machine('d-pc', 'Gaming PC', 'unreachable'),
        ],
      }),
    );
    // New Workspace hides the row then; the proposal card reads every row.
    expect(selectStartOnOptions.select(store.state)).toEqual([]);
    const rows = selectStartOnRows.select(store.state);
    expect(startOnDefault(rows)).toBe('d-pc');
    expect(rows[0]).toMatchObject({ id: 'd-pc', disabled: true });
  });
});

describe('Start On on a Full backend', () => {
  it.each([undefined, 'regular'] as const)(
    'keeps the backend row with its own label and platform (daemonMode %s)',
    (daemonMode) => {
      seed(daemonMode, [
        { kind: 'machine', nodeId: 'd-pc', name: 'Gaming PC' },
        { kind: 'local', name: 'Hub server' },
        { kind: 'machine', nodeId: 'd-mac', name: 'Mac Studio' },
      ]);
      const options = selectStartOnOptions.select(store.state);

      expect(options.map((option) => option.id)).toEqual(['d-pc', START_ON_HOST, 'd-mac']);
      expect(options[1]).toMatchObject({ label: backend.label, platform: 'Linux x64' });
      // The first runner in the host's order is preselected.
      expect(selectEffectiveStartOn.select(store.state, undefined)).toBe('d-pc');
    },
  );

  it('preselects the host itself when it runs agents and comes first', () => {
    seed('regular', [
      { kind: 'local', name: 'Hub server' },
      { kind: 'machine', nodeId: 'd-pc', name: 'Gaming PC' },
    ]);
    expect(selectEffectiveStartOn.select(store.state, undefined)).toBe(START_ON_HOST);
    expect(selectEffectiveStartOn.select(store.state, 'd-pc')).toBe('d-pc');
  });

  it('keeps the host when the user picks it while a runner comes first', () => {
    seed('regular', [
      { kind: 'machine', nodeId: 'd-pc', name: 'Gaming PC' },
      { kind: 'local', name: 'Hub server' },
    ]);
    expect(selectEffectiveStartOn.select(store.state, undefined)).toBe('d-pc');
    const picked = selectEffectiveStartOn.select(store.state, START_ON_HOST);
    expect(picked).toBe(START_ON_HOST);
    expect(initialAgentPlacement(picked)).toEqual({ target: 'local' });
  });
});

describe('Model row machine for a Start On choice', () => {
  it('lists the first usable runner in order for an omitted placement on an orchestrator', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    const options = selectStartOnOptions.select(store.state);
    expect(startOnModelMachineId(START_ON_BACKEND, options, true)).toBe('d-pc');
    // A chosen machine is its own source; a cloud entry has no report yet.
    expect(startOnModelMachineId('d-mac', options, true)).toBe('d-mac');
    expect(startOnModelMachineId('cloud:e2b', options, true)).toBeUndefined();
  });

  it('skips machines that cannot start an agent', () => {
    const options = [
      { id: START_ON_HOST, label: 'Host', platform: null, disabled: false },
      { id: 'd-off', label: 'Off', platform: null, disabled: true },
      { id: 'cloud:e2b', label: 'E2B', platform: null, disabled: false, kind: 'cloud' as const },
      { id: 'd-on', label: 'On', platform: null, disabled: false },
    ];
    expect(startOnModelMachineId(START_ON_BACKEND, options, true)).toBe('d-on');
  });

  it("keeps the backend's own models on a Full backend", () => {
    seed('regular', [{ kind: 'machine', nodeId: 'd-pc', name: 'Gaming PC' }]);
    const options = selectStartOnOptions.select(store.state);
    expect(startOnModelMachineId(START_ON_BACKEND, options, false)).toBeUndefined();
  });
});

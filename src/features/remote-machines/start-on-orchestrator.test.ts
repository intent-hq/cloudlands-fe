/**
 * Start On against an orchestrator (PROTOCOL `methods/nodes.md` →
 * "Orchestrator mode" and "One ordered list"): the backend never runs agents,
 * so there is no "this machine" choice. The omitted placement, which walks the
 * ordered machine list, is offered first as "First available machine"; the
 * machines follow in the stored order. A Full backend keeps its own row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord, DaemonMode } from '$shared/types/connections';
import type { MachineOrderRow, RemoteMachine } from '$shared/types/remote-machines';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { remoteMachinesLoaded } from './remote-machines-slice';
import { selectEffectiveStartOn, selectStartOnOptions } from './remote-machines-selectors';
import {
  initialAgentPlacement,
  START_ON_BACKEND,
  startOnBackendLabel,
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
  it('offers no backend choice: "First available machine" first, then the machines in order', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    const options = selectStartOnOptions.select(store.state);

    expect(options.map((option) => option.id)).toEqual([START_ON_BACKEND, 'd-pc', 'd-mac']);
    expect(options.map((option) => option.label)).not.toContain(backend.label);
    expect(options[0]).toMatchObject({
      label: m.remoteMachines_startOn_firstAvailable_label(),
      platform: null,
      disabled: false,
    });
    // Messages that name "where it starts" read the same row.
    expect(startOnBackendLabel(options)).toBe(m.remoteMachines_startOn_firstAvailable_label());
  });

  it('sends no placement for that choice, so the backend walks its ordered list', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    const effective = selectEffectiveStartOn.select(store.state, undefined);

    expect(effective).toBe(START_ON_BACKEND);
    expect(initialAgentPlacement(effective)).toBeUndefined();
    expect(initialAgentPlacement('d-pc')).toEqual({
      target: 'remote',
      checkout: 'isolated',
      nodeId: 'd-pc',
    });
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

      expect(options.map((option) => option.id)).toEqual(['d-pc', START_ON_BACKEND, 'd-mac']);
      expect(options[1]).toMatchObject({ label: backend.label, platform: 'Linux x64' });
    },
  );
});

describe('Model row machine for a Start On choice', () => {
  it('lists the first usable machine in order for "First available machine" on an orchestrator', () => {
    seed('orchestrator', ORCHESTRATOR_ORDER);
    const options = selectStartOnOptions.select(store.state);
    expect(startOnModelMachineId(START_ON_BACKEND, options, true)).toBe('d-pc');
    // A chosen machine is its own source; a cloud entry has no report yet.
    expect(startOnModelMachineId('d-mac', options, true)).toBe('d-mac');
    expect(startOnModelMachineId('cloud:e2b', options, true)).toBeUndefined();
  });

  it('skips machines that cannot start an agent', () => {
    const options = [
      { id: START_ON_BACKEND, label: 'First', platform: null, disabled: false },
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

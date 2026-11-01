import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  remoteMachineOperationSettled,
  remoteMachineOperationStarted,
  remoteMachinesLoaded,
} from '$features/remote-machines/remote-machines-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import type {
  ExecutorBackend,
  RemoteMachine,
  RemoteMachineFailure,
  RemoteMachineState,
} from '$shared/types/remote-machines';

export type RemoteMachinesPreviewState =
  | 'expose'
  | 'exposing'
  | 'listener-off'
  | 'available'
  | 'in-use'
  | 'stops-unconfirmed'
  | 'update-required'
  | 'revoked'
  | 'unreachable'
  | 'unsupported';

const CONNECTIONS: ConnectionRecord[] = [
  {
    id: 'local',
    label: 'This machine',
    host: null,
    port: null,
    fingerprint: null,
    isLocal: true,
    status: 'connected',
  },
  {
    id: 'build-box',
    label: 'Build box',
    host: '192.0.2.10',
    port: 5179,
    fingerprint: 'BB:01',
    isLocal: false,
    status: 'connected',
  },
  {
    id: 'studio-mac',
    label: 'Studio Mac',
    host: '192.0.2.4',
    port: 5179,
    fingerprint: 'AA:BB',
    isLocal: false,
    status: 'connected',
  },
  {
    id: 'lab-pc',
    label: 'Lab PC',
    host: '192.0.2.7',
    port: 5179,
    fingerprint: 'CC:DD',
    isLocal: false,
    status: 'connected',
  },
];

function machine(state: RemoteMachineState, runningAgents = 0): RemoteMachine {
  return {
    id: 'd-studio-mac',
    name: 'Studio Mac',
    platform: { os: 'macos', arch: 'aarch64' },
    hosts: ['192.0.2.4'],
    port: 5179,
    tcAddress: 'tc-studio-mac',
    fingerprint: 'AA:BB',
    state,
    runningAgents,
    capabilities: { providers: [{ id: 'claude', status: 'signed-in', models: ['opus'] }] },
    observedAt: '2026-10-30T00:00:00Z',
    addedAt: '2026-10-30T00:00:00Z',
  };
}

const BACKENDS: ExecutorBackend[] = [
  {
    credentialId: 'cred-laptop',
    backendId: 'head-laptop',
    backendName: 'Travel laptop',
    createdAt: '2026-10-29T00:00:00Z',
    connected: true,
    runningAgents: 1,
  },
];

function failure(key: string, value: RemoteMachineFailure) {
  store.dispatch(remoteMachineOperationStarted(key, 'exposing'));
  store.dispatch(remoteMachineOperationSettled(key, value));
}

/** Seed the Machines settings with one current backend and owner machines in a named state. */
export function setupRemoteMachinesFixture(state: RemoteMachinesPreviewState) {
  const before = store.state;
  const previousConnections = selectConnections.select(before);
  store.dispatch(
    connectionsListReceived({
      connections: CONNECTIONS,
      activeId: 'build-box',
      windowBackendId: 'build-box',
    }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(backendReconnected());
  const exposed: Partial<Record<RemoteMachinesPreviewState, RemoteMachine>> = {
    available: machine('connected', 1),
    'in-use': machine('connected', 2),
    'stops-unconfirmed': machine('unreachable', 2),
    'update-required': machine('update-required'),
    revoked: machine('revoked'),
    unreachable: machine('unreachable'),
  };
  store.dispatch(
    remoteMachinesLoaded({
      supported: state !== 'unsupported',
      machines: exposed[state] ? [exposed[state]] : [],
      localFingerprint: 'EE:FF',
      executorBackends: BACKENDS,
    }),
  );
  if (state === 'exposing') store.dispatch(remoteMachineOperationStarted('studio-mac', 'exposing'));
  if (state === 'listener-off') failure('local', { success: false, code: 'listener-off' });
  if (state === 'in-use')
    failure('d-studio-mac', { success: false, code: 'machine-in-use', runningAgents: 2 });
  if (state === 'stops-unconfirmed')
    failure('d-studio-mac', {
      success: false,
      code: 'machine-unreachable',
      message: 'Studio Mac did not confirm 2 agent stops',
      attempts: [],
      unconfirmedStops: ['agent-1', 'agent-2'],
    });
  if (state === 'update-required')
    failure('lab-pc', {
      success: false,
      code: 'machine-update-required',
      update: 'machine',
      machineVersion: '2.200.0',
      backendVersion: '2.256.0',
    });
  if (state === 'unreachable')
    failure('lab-pc', {
      success: false,
      code: 'machine-unreachable',
      attempts: [
        { route: '192.0.2.7:5179', error: 'node-link-connect-timeout' },
        { route: 'tailcat', error: 'node-link-certificate-mismatch' },
      ],
    });
  return () => {
    store.dispatch(backendReconnected());
    store.dispatch(
      connectionsListReceived({
        connections: previousConnections,
        activeId: before.connections.activeId,
        windowBackendId: before.connections.windowBackendId,
      }),
    );
  };
}

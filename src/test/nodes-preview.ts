import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  remoteMachineOperationStarted,
  remoteMachinesLoaded,
} from '$features/remote-machines/remote-machines-slice';
import {
  pasteClosed,
  pasteFailed,
  pasteFieldOpened,
  pasteTestingStarted,
  rowHighlighted,
} from '$features/nodes/nodes-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { maskPairingUri } from '$shared/utils/pairing-uri';
import { maskNodeInviteUri } from '$shared/utils/node-invite-uri';

export type NodesPreviewState =
  | 'no-nodes'
  | 'machines-and-nodes'
  | 'paste-field'
  | 'testing'
  | 'added-machine'
  | 'node-not-now'
  | 'making-available'
  | 'node-added'
  | 'not-a-link'
  | 'unreachable'
  | 'wrong-token'
  | 'backend-unsupported'
  | 'labs-off'
  | InvitePreviewState;

/** After an `intent://node` link: claiming, claimed (listed under Nodes), and each failure. */
type InvitePreviewState =
  | 'invite-claiming'
  | 'invite-claimed'
  | 'invite-used'
  | 'invite-expired'
  | 'invite-revoked'
  | 'invite-invalid'
  | 'invite-unreachable'
  | 'invite-update-required'
  | 'invite-not-owner'
  | 'invites-unsupported'
  | 'invite-labs-off'
  | 'link-version';

export const NODE_INVITE_SECRET = 'invite-secret-value';
export const NODE_INVITE_LINK = `intent://node?v=1&host=192.0.2.40&port=7443&fp=AA%3A40&tc=tc-lab-node&invite=inv_7&secret=${NODE_INVITE_SECRET}&name=Lab%20node`;

const isInviteState = (state: NodesPreviewState): state is InvitePreviewState =>
  state.startsWith('invite') || state === 'link-version';

/** A machine the backend claimed from a node link; this app has no connection to it. */
const LAB_NODE: RemoteMachine = {
  id: 'd-lab-node',
  name: 'Lab node',
  platform: { os: 'linux', arch: 'aarch64' },
  hosts: ['192.0.2.40'],
  port: 7443,
  fingerprint: 'AA:40',
  state: 'connected',
  runningAgents: 0,
  capabilities: { providers: [{ id: 'claude', status: 'signed-in', models: ['opus'] }] },
  observedAt: '2026-11-10T00:00:00Z',
  addedAt: '2026-11-10T00:00:00Z',
};

export const NODE_LINK =
  'intent://pair?v=1&host=192.0.2.20&port=7443&fp=AA%3A20&token=owner-secret-token&mode=node&tc=tc-gpu-rig';

const MACHINES: ConnectionRecord[] = [
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
    daemonMode: 'regular',
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
];

const GPU_RIG: ConnectionRecord = {
  id: 'gpu-rig',
  label: 'GPU rig',
  host: '192.0.2.20',
  port: 7443,
  fingerprint: 'AA:20',
  isLocal: false,
  status: 'not-open',
  daemonMode: 'node',
};

const PI: ConnectionRecord = {
  id: 'pi-node',
  label: 'Garage Pi',
  host: '192.0.2.30',
  port: 7443,
  fingerprint: 'AA:30',
  isLocal: false,
  status: 'not-open',
  daemonMode: 'node',
};

function exposed(connection: ConnectionRecord, runningAgents = 0): RemoteMachine {
  return {
    id: `d-${connection.id}`,
    name: connection.label,
    platform: { os: 'linux', arch: 'x86_64' },
    hosts: [connection.host ?? ''],
    port: connection.port ?? 0,
    fingerprint: connection.fingerprint ?? '',
    state: 'connected',
    runningAgents,
    capabilities: { providers: [{ id: 'claude', status: 'signed-in', models: ['opus'] }] },
    observedAt: '2026-11-07T00:00:00Z',
    addedAt: '2026-11-07T00:00:00Z',
  };
}

/** Seed Settings → Machines (current backend: Build box) in a named Nodes state. */
export function setupNodesFixture(state: NodesPreviewState) {
  const before = store.state;
  const previousConnections = selectConnections.select(before);
  const previousLabs = before.userPreferences?.labsRemoteAgentsEnabled === true;
  const nodes: ConnectionRecord[] =
    state === 'no-nodes' ||
    state === 'added-machine' ||
    state.startsWith('paste') ||
    isInviteState(state) ||
    [
      'testing',
      'not-a-link',
      'unreachable',
      'wrong-token',
      'backend-unsupported',
      'labs-off',
    ].includes(state)
      ? []
      : state === 'machines-and-nodes'
        ? [GPU_RIG, PI]
        : [GPU_RIG];
  const machines =
    state === 'added-machine'
      ? [
          ...MACHINES,
          {
            id: 'lab-pc',
            label: 'Lab PC',
            host: '192.0.2.7',
            port: 5179,
            fingerprint: 'CC:DD',
            isLocal: false,
            status: 'not-open',
            daemonMode: 'regular',
          } satisfies ConnectionRecord,
        ]
      : MACHINES;
  store.dispatch(
    connectionsListReceived({
      connections: [...machines, ...nodes],
      activeId: 'build-box',
      windowBackendId: 'build-box',
    }),
  );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(backendReconnected());
  store.dispatch(setLabsRemoteAgentsEnabled(state !== 'labs-off' && state !== 'invite-labs-off'));
  const exposedRows =
    state === 'machines-and-nodes'
      ? [exposed(GPU_RIG, 2), exposed(MACHINES[2])]
      : state === 'node-added'
        ? [exposed(GPU_RIG)]
        : state === 'invite-claimed'
          ? [LAB_NODE]
          : [];
  store.dispatch(
    remoteMachinesLoaded({
      supported: state !== 'backend-unsupported',
      claimInvites: state !== 'invites-unsupported',
      machines: exposedRows,
      localFingerprint: 'EE:FF',
      executorBackends: [],
    }),
  );
  store.dispatch(pasteClosed());
  store.dispatch(rowHighlighted(null));
  if (state === 'paste-field') store.dispatch(pasteFieldOpened());
  if (state === 'testing') store.dispatch(pasteTestingStarted(maskPairingUri(NODE_LINK)));
  if (state === 'added-machine') store.dispatch(rowHighlighted('lab-pc'));
  if (state === 'invite-claimed') store.dispatch(rowHighlighted(LAB_NODE.id));
  if (state === 'invite-claiming')
    store.dispatch(pasteTestingStarted(maskNodeInviteUri(NODE_INVITE_LINK)));
  if (state === 'node-added' || state === 'node-not-now') store.dispatch(rowHighlighted('gpu-rig'));
  if (state === 'making-available')
    store.dispatch(remoteMachineOperationStarted('gpu-rig', 'exposing'));
  const failures: Partial<Record<NodesPreviewState, Parameters<typeof pasteFailed>[0]>> = {
    'not-a-link': { code: 'not-a-link' },
    unreachable: { code: 'unreachable', routes: ['192.0.2.20:7443', 'tc-gpu-rig'] },
    'wrong-token': { code: 'rejected' },
    'backend-unsupported': { code: 'backend-unsupported', node: 'GPU rig' },
    'labs-off': { code: 'labs-off', node: 'GPU rig' },
    'invite-used': { code: 'invite-used', node: 'Lab node' },
    'invite-expired': { code: 'invite-expired', node: 'Lab node' },
    'invite-revoked': { code: 'invite-revoked', node: 'Lab node' },
    'invite-invalid': { code: 'invite-invalid', node: 'Lab node' },
    'invite-unreachable': {
      code: 'machine-unreachable',
      node: 'Lab node',
      routes: ['192.0.2.40:7443', 'tc-lab-node'],
    },
    'invite-update-required': { code: 'machine-update-required', node: 'Lab node' },
    'invite-not-owner': { code: 'invite-not-owner', node: 'Lab node' },
    'invites-unsupported': { code: 'invites-unsupported', node: 'Lab node' },
    'invite-labs-off': { code: 'labs-off', node: 'Lab node' },
    'link-version': { code: 'link-version' },
  };
  const failure = failures[state];
  if (failure) {
    store.dispatch(
      pasteTestingStarted(
        isInviteState(state) ? maskNodeInviteUri(NODE_INVITE_LINK) : maskPairingUri(NODE_LINK),
      ),
    );
    store.dispatch(pasteFailed(failure));
  }
  return () => {
    store.dispatch(pasteClosed());
    store.dispatch(rowHighlighted(null));
    store.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
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

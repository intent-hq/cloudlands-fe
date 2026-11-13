import { store } from '$store/renderer/store';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import { admitLegacyPrincipal, withHostPrincipal } from './fixtures/principal-state';
import {
  machineOrderSaveSettled,
  machineOrderSaveStarted,
  remoteMachinesLoaded,
} from '$features/remote-machines/remote-machines-slice';
import type { MachineOrderRow, RemoteMachine } from '$shared/types/remote-machines';
import { setupCloudMachinesFixture, TEAM_ENTRY } from './cloud-machines-preview';

export type MachineOrderPreviewState =
  'owner' | 'member' | 'saving' | 'unsupported' | 'exceptions' | 'disconnected';

const STUDIO: RemoteMachine = {
  id: 'd-studio-mac',
  name: 'Studio Mac',
  platform: { os: 'macos', arch: 'aarch64' },
  hosts: ['192.0.2.4'],
  port: 5179,
  fingerprint: 'AA:BB',
  state: 'connected',
  runningAgents: 1,
  capabilities: { providers: [{ id: 'claude', status: 'signed-in', models: ['opus'] }] },
  addedAt: '2026-10-30T00:00:00Z',
};

/** Added from an intent://node link: this app has no saved connection to it. */
const GARAGE: RemoteMachine = {
  ...STUDIO,
  id: 'd-garage',
  name: 'Garage node',
  platform: { os: 'linux', arch: 'x86_64' },
  hosts: ['192.0.2.20'],
  fingerprint: '11:22',
  runningAgents: 0,
  addedAt: '2026-11-02T00:00:00Z',
};

/** Idle between launches (connected on demand), with its last report kept. */
const GARAGE_IDLE: RemoteMachine = {
  ...GARAGE,
  state: 'disconnected',
  capabilities: {
    intentdVersion: '0.11.197',
    providers: [
      { id: 'claude-code', status: 'signed-in', models: ['opus'] },
      { id: 'unsloth', status: 'unknown', models: [] },
      { id: 'grok', status: 'cli-missing', models: [] },
      { id: 'cortex', visible: false, status: 'signed-in', models: [] },
    ],
  },
};

/** Idle, and its last report has no provider it can run. */
const CACHE_IDLE: RemoteMachine = {
  ...GARAGE,
  id: 'd-cache',
  name: 'Cache box',
  hosts: ['192.0.2.30'],
  fingerprint: '33:44',
  state: 'disconnected',
  capabilities: {
    intentdVersion: '0.11.197',
    providers: [
      { id: 'claude-code', status: 'cli-missing', models: [] },
      { id: 'pi', status: 'prerequisite-missing', models: [] },
    ],
  },
  addedAt: '2026-11-03T00:00:00Z',
};

const ORDER: MachineOrderRow[] = [
  { kind: 'machine', nodeId: GARAGE.id, name: GARAGE.name },
  { kind: 'local', name: 'build-box' },
  { kind: 'cloud', cloudMachineId: 'e2b', name: 'E2B' },
  { kind: 'machine', nodeId: STUDIO.id, name: STUDIO.name },
  { kind: 'cloud', cloudMachineId: TEAM_ENTRY.id, name: TEAM_ENTRY.name },
];

/**
 * Settings → Machines on a backend with `machineOrder: 1`: one ordered list of
 * a node, the backend itself, cloud entries and an exposed full daemon.
 */
export function setupMachineOrderFixture(state: MachineOrderPreviewState) {
  const exceptions = state === 'exceptions';
  const disconnected = state === 'disconnected';
  const restoreCloud = setupCloudMachinesFixture(exceptions ? 'entries-key-rejected' : 'entries');
  const ordered = state !== 'unsupported';
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machineOrder: ordered,
      order: !ordered
        ? null
        : disconnected
          ? [...ORDER, { kind: 'machine', nodeId: CACHE_IDLE.id, name: CACHE_IDLE.name }]
          : ORDER,
      machines: exceptions
        ? [
            { ...STUDIO, state: 'update-required' },
            { ...GARAGE, state: 'unreachable' },
          ]
        : disconnected
          ? [STUDIO, GARAGE_IDLE, CACHE_IDLE]
          : [STUDIO, GARAGE],
      localFingerprint: 'EE:FF',
      executorBackends: [],
    }),
  );
  if (state === 'saving') store.dispatch(machineOrderSaveStarted('preview-save', ORDER));
  // The owner reorders; a member reads the same list.
  admitLegacyPrincipal('owner');
  const { context, invalidation, presentationVersion } = store.state.principal;
  const member = withHostPrincipal(store.state, 'member').principal.snapshot;
  if (state === 'member' && context && member)
    store.dispatch(principalReceived({ context, invalidation, presentationVersion }, member));
  return () => {
    store.dispatch(machineOrderSaveSettled('preview-save'));
    restoreCloud();
  };
}

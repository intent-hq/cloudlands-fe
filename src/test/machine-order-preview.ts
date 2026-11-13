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

export type MachineOrderPreviewState = 'owner' | 'member' | 'saving' | 'unsupported' | 'exceptions';

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
  const restoreCloud = setupCloudMachinesFixture(exceptions ? 'entries-key-rejected' : 'entries');
  const ordered = state !== 'unsupported';
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machineOrder: ordered,
      order: ordered ? ORDER : null,
      machines: exceptions
        ? [
            { ...STUDIO, state: 'update-required' },
            { ...GARAGE, state: 'unreachable' },
          ]
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

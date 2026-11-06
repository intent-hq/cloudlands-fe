import { store } from '$store/renderer/store';
import { setupRemoteMachinesFixture } from './remote-machines-preview';
import {
  CLOUD_REMOVE_KEY,
  CLOUD_VALIDATE_KEY,
  cloudMachineOperationSettled,
  cloudMachineOperationStarted,
  cloudMachinesLoaded,
  cloudMachineValidated,
} from '$features/cloud-machines/cloud-machines-slice';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { CloudMachineProvider } from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';

export type CloudMachinesPreviewState =
  | 'add-menu'
  | 'setup'
  | 'setup-tested'
  | 'setup-key-rejected'
  | 'connected'
  | 'connected-no-sandboxes'
  | 'key-rejected'
  | 'remove-in-use'
  | 'unsupported';

export const E2B_PROVIDER: CloudMachineProvider = {
  id: 'e2b',
  name: 'E2B',
  state: 'ready',
  template: 'intent/intent-node-4x8:0.212.0',
  templateProject: 'intent',
  agentProviders: ['claude-code', 'codex'],
  sizes: [
    { id: '2x4', vcpu: 2, memoryMiB: 4096, plan: 'hobby' },
    { id: '4x8', vcpu: 4, memoryMiB: 8192, plan: 'hobby' },
    { id: '8x16', vcpu: 8, memoryMiB: 16384, plan: 'pro-raised-limits' },
    { id: '16x32', vcpu: 16, memoryMiB: 32768, plan: 'pro-raised-limits' },
  ],
  size: '4x8',
  idlePauseMinutes: 10,
  pausedDeleteDays: 7,
  configuredAt: '2026-11-06T09:00:00.000Z',
  checkedAt: '2026-11-06T11:55:00.000Z',
};

const WORKSPACES = [
  { id: 'ws-ci', title: 'Fix flaky CI' },
  { id: 'ws-docs', title: 'Protocol docs' },
  { id: 'ws-perf', title: 'Startup time' },
];

function sandbox(
  id: string,
  agent: string,
  workspaceId: string,
  by: string,
  state: 'running' | 'paused',
  runningSeconds: number,
): RemoteMachine {
  return {
    id,
    name: `E2B · ${agent}`,
    platform: { os: 'linux', arch: 'x86_64' },
    hosts: [],
    port: 5179,
    tcAddress: `tc-${id}`,
    fingerprint: `fp-${id}`,
    state: state === 'running' ? 'connected' : 'disconnected',
    runningAgents: 1,
    addedAt: '2026-11-06T10:00:00.000Z',
    cloud: {
      provider: 'e2b',
      sandboxId: `i${id}`,
      state,
      template: E2B_PROVIDER.template,
      size: '4x8',
      startedBy: { principalId: `p-${by}`, displayName: by },
      agentId: `agent-${id}`,
      workspaceId,
      startedAt: '2026-11-06T10:00:00.000Z',
      runningSeconds,
    },
  };
}

export const E2B_SANDBOXES: RemoteMachine[] = [
  sandbox('sb-1', 'iOS build fixer', 'ws-ci', 'Clément', 'running', 42 * 60),
  sandbox('sb-2', 'Docs sweeper', 'ws-docs', 'Sam', 'running', 72 * 60),
  sandbox('sb-3', 'Perf profiler', 'ws-perf', 'Clément', 'paused', 17 * 60),
];

/** Seed Settings → Machines with E2B in a named state on top of the remote-machines fixture. */
export function setupCloudMachinesFixture(state: CloudMachinesPreviewState) {
  const restoreRemote = setupRemoteMachinesFixture('available');
  for (const workspace of WORKSPACES)
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(workspace.id),
        branch: workspace.id,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        title: workspace.title,
        path: `/tmp/${workspace.id}`,
        status: WorkspaceStatus.Active,
        createdAt: '2026-11-06T09:00:00.000Z',
        updatedAt: '2026-11-06T09:00:00.000Z',
      }),
    );
  const configured = ![
    'add-menu',
    'setup',
    'setup-tested',
    'setup-key-rejected',
    'unsupported',
  ].includes(state);
  store.dispatch(
    cloudMachinesLoaded({
      supported: state !== 'unsupported',
      providers: configured
        ? [state === 'key-rejected' ? { ...E2B_PROVIDER, state: 'key-rejected' } : E2B_PROVIDER]
        : [],
      machines: configured && state !== 'connected-no-sandboxes' ? E2B_SANDBOXES : [],
      // Read now: uptime and cost then match the fixture until the next 30 s tick.
      readAt: Date.now(),
    }),
  );
  if (state === 'setup-tested') store.dispatch(cloudMachineValidated(E2B_PROVIDER));
  if (state === 'setup-key-rejected') {
    store.dispatch(cloudMachineOperationStarted(CLOUD_VALIDATE_KEY, 'testing'));
    store.dispatch(
      cloudMachineOperationSettled(CLOUD_VALIDATE_KEY, {
        message: 'E2B rejected the API key',
        cloud: { code: 'cloud-machine-unavailable', reason: 'key-rejected', retryable: false },
      }),
    );
  }
  if (state === 'remove-in-use') {
    store.dispatch(cloudMachineOperationStarted(CLOUD_REMOVE_KEY, 'removing'));
    store.dispatch(
      cloudMachineOperationSettled(CLOUD_REMOVE_KEY, {
        message: 'E2B has 3 sandboxes with agents. Stop them first, or remove with stopAgents.',
        inUse: true,
      }),
    );
  }
  return () => {
    for (const workspace of WORKSPACES) store.dispatch(removeWorkspaceEntity(workspace.id));
    restoreRemote();
  };
}

import { store } from '$store/renderer/store';
import { setLabsCloudMachinesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { setupRemoteMachinesFixture } from './remote-machines-preview';
import {
  NEW_CLOUD_ENTRY,
  cloudConfigureKey,
  cloudRemoveKey,
  cloudValidateKey,
  cloudMachineOperationSettled,
  cloudMachineOperationStarted,
  cloudMachinesLoaded,
  cloudMachineValidated,
} from '$features/cloud-machines/cloud-machines-slice';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { CloudMachineProvider, CloudProviderKind } from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';
import {
  collapsedSandboxGroups,
  sandboxGroupId,
} from '$features/cloud-machines/sandbox-groups.svelte';

export type CloudMachinesPreviewState =
  | 'add-menu'
  | 'setup'
  | 'setup-tested'
  | 'setup-key-rejected'
  | 'connected'
  | 'connected-no-sandboxes'
  | 'key-rejected'
  | 'remove-in-use'
  | 'unsupported'
  | 'labs-off'
  | 'entries'
  | 'entries-add'
  | 'entries-key-rejected'
  | 'entries-rename-taken'
  | 'entries-single'
  | 'entries-edit'
  | 'sandboxes-grouped'
  | 'sandboxes-collapsed'
  | 'add-cloud-menu'
  | 'northflank-setup'
  | 'northflank-setup-filled'
  | 'northflank-setup-error'
  | 'providers';

/** Scenes of a backend that offers Northflank as well as E2B. */
const NORTHFLANK_SCENES: readonly CloudMachinesPreviewState[] = [
  'add-cloud-menu',
  'northflank-setup',
  'northflank-setup-filled',
  'northflank-setup-error',
  'providers',
];

/** Scenes where the backend keeps named entries (`cloudMachineEntries: 1`). */
const ENTRY_SCENES: readonly CloudMachinesPreviewState[] = [
  'entries',
  'entries-add',
  'entries-key-rejected',
  'entries-rename-taken',
  'entries-single',
  'entries-edit',
  ...NORTHFLANK_SCENES,
];

export const E2B_PROVIDER: CloudMachineProvider = {
  id: 'e2b',
  provider: 'e2b',
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

/** A second entry on another E2B project, with a larger size. */
export const TEAM_ENTRY: CloudMachineProvider = {
  ...E2B_PROVIDER,
  id: 'e2b-3f9a0c71d2b4',
  name: 'Team project',
  template: 'intent/intent-node-8x16:0.212.0',
  size: '8x16',
  idlePauseMinutes: 30,
  configuredAt: '2026-11-07T08:00:00.000Z',
};

/** A Northflank entry: services in one project (and its region), a plan per size. */
export const NORTHFLANK_ENTRY: CloudMachineProvider = {
  id: 'northflank-7c2e91a0b3d4',
  provider: 'northflank',
  name: 'Agents EU',
  state: 'ready',
  template: 'ghcr.io/intent-hq/intent-node:0.212.0',
  templateProject: '',
  agentProviders: ['claude-code', 'codex'],
  sizes: [
    { id: '2x4', vcpu: 2, memoryMiB: 4096, deploymentPlan: 'nf-compute-200' },
    { id: '4x8', vcpu: 4, memoryMiB: 8192, deploymentPlan: 'nf-compute-400' },
    { id: '8x16', vcpu: 8, memoryMiB: 16384, deploymentPlan: 'nf-compute-800-16' },
  ],
  size: '4x8',
  idlePauseMinutes: 15,
  pausedDeleteDays: 7,
  configuredAt: '2026-11-08T08:00:00.000Z',
  checkedAt: '2026-11-08T09:00:00.000Z',
  northflank: {
    projectId: 'intent-agents',
    region: 'europe-west',
    image: 'ghcr.io/intent-hq/intent-node',
    plans: { '2x4': 'nf-compute-200', '4x8': 'nf-compute-400', '8x16': 'nf-compute-800-16' },
    diskGiB: 20,
  },
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
  entry: CloudMachineProvider = E2B_PROVIDER,
  startedAt = '2026-11-06T10:00:00.000Z',
): RemoteMachine {
  return {
    id,
    name: `${entry.name} · ${agent}`,
    platform: { os: 'linux', arch: 'x86_64' },
    hosts: [],
    port: 5179,
    tcAddress: `tc-${id}`,
    fingerprint: `fp-${id}`,
    state: state === 'running' ? 'connected' : 'disconnected',
    runningAgents: 1,
    addedAt: '2026-11-06T10:00:00.000Z',
    cloud: {
      provider: entry.provider,
      cloudMachineId: entry.id,
      sandboxId: `i${id}`,
      state,
      template: entry.template,
      size: entry.size,
      startedBy: { principalId: `p-${by}`, displayName: by },
      agentId: `agent-${id}`,
      workspaceId,
      startedAt,
      runningSeconds,
    },
  };
}

export const E2B_SANDBOXES: RemoteMachine[] = [
  sandbox('sb-1', 'iOS build fixer', 'ws-ci', 'Clément', 'running', 42 * 60),
  sandbox('sb-2', 'Docs sweeper', 'ws-docs', 'Sam', 'running', 72 * 60),
  sandbox('sb-3', 'Perf profiler', 'ws-perf', 'Clément', 'paused', 17 * 60),
];

export const NORTHFLANK_SANDBOXES: RemoteMachine[] = [
  sandbox('nf-1', 'Migration runner', 'ws-perf', 'Clément', 'running', 25 * 60, NORTHFLANK_ENTRY),
  sandbox('nf-2', 'Flaky test hunter', 'ws-ci', 'Sam', 'paused', 9 * 60, NORTHFLANK_ENTRY),
];

export const TEAM_SANDBOXES: RemoteMachine[] = [
  sandbox('sb-t1', 'Release notes', 'ws-docs', 'Sam', 'running', 8 * 60, TEAM_ENTRY),
];

/**
 * Several workspaces: "Fix flaky CI" has two running sandboxes (the newer
 * one first) and a newer paused one; "Startup time" is only paused; one
 * sandbox's workspace is unknown here, under "Other".
 */
export const GROUPED_SANDBOXES: RemoteMachine[] = [
  ...E2B_SANDBOXES,
  sandbox(
    'sb-4',
    'Test retrier',
    'ws-ci',
    'Sam',
    'paused',
    5 * 60,
    E2B_PROVIDER,
    '2026-11-06T11:30:00.000Z',
  ),
  sandbox(
    'sb-6',
    'Lint fixer',
    'ws-ci',
    'Alex',
    'running',
    20 * 60,
    E2B_PROVIDER,
    '2026-11-06T11:00:00.000Z',
  ),
  sandbox(
    'sb-5',
    'Dependency bump across every workspace package and its lockfile',
    'ws-elsewhere',
    'Alex',
    'running',
    3 * 60,
  ),
];

/** Seed Settings → Machines with E2B in a named state on top of the remote-machines fixture. */
export function setupCloudMachinesFixture(state: CloudMachinesPreviewState) {
  const restoreRemote = setupRemoteMachinesFixture('available');
  const previousCloudLabs = store.state.userPreferences?.labsCloudMachinesEnabled === true;
  store.dispatch(setLabsCloudMachinesEnabled(state !== 'labs-off'));
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
  const entries = ENTRY_SCENES.includes(state);
  const team =
    state === 'entries-key-rejected' ? { ...TEAM_ENTRY, state: 'key-rejected' } : TEAM_ENTRY;
  const northflank = NORTHFLANK_SCENES.includes(state);
  // The menu and setup scenes start from E2B alone, so Northflank is the one added.
  const northflankProviders =
    state === 'providers' ? [E2B_PROVIDER, NORTHFLANK_ENTRY] : [E2B_PROVIDER];
  store.dispatch(
    cloudMachinesLoaded({
      supported: state !== 'unsupported',
      entries,
      ...(northflank ? { providerKinds: ['e2b', 'northflank'] satisfies CloudProviderKind[] } : {}),
      providers: northflank
        ? northflankProviders
        : entries
          ? state === 'entries-single' || state === 'entries-edit'
            ? [E2B_PROVIDER]
            : [E2B_PROVIDER, team]
          : configured
            ? [state === 'key-rejected' ? { ...E2B_PROVIDER, state: 'key-rejected' } : E2B_PROVIDER]
            : [],
      machines: northflank
        ? state === 'providers'
          ? [...E2B_SANDBOXES.slice(0, 1), ...NORTHFLANK_SANDBOXES]
          : []
        : entries
          ? state === 'entries-single' || state === 'entries-edit'
            ? E2B_SANDBOXES
            : [...E2B_SANDBOXES, ...TEAM_SANDBOXES]
          : state === 'sandboxes-grouped' || state === 'sandboxes-collapsed'
            ? GROUPED_SANDBOXES
            : configured && state !== 'connected-no-sandboxes'
              ? E2B_SANDBOXES
              : [],
      // Read now: uptime then matches the fixture until the next 30 s tick.
      readAt: Date.now(),
    }),
  );
  if (state === 'setup-tested')
    store.dispatch(cloudMachineValidated(NEW_CLOUD_ENTRY, E2B_PROVIDER));
  if (state === 'setup-key-rejected') {
    store.dispatch(cloudMachineOperationStarted(cloudValidateKey(NEW_CLOUD_ENTRY), 'testing'));
    store.dispatch(
      cloudMachineOperationSettled(cloudValidateKey(NEW_CLOUD_ENTRY), {
        message: 'E2B rejected the API key',
        cloud: { code: 'cloud-machine-unavailable', reason: 'key-rejected', retryable: false },
      }),
    );
  }
  if (state === 'northflank-setup-filled')
    store.dispatch(cloudMachineValidated(NEW_CLOUD_ENTRY, { ...NORTHFLANK_ENTRY, id: '' }));
  if (state === 'northflank-setup-error') {
    store.dispatch(cloudMachineOperationStarted(cloudValidateKey(NEW_CLOUD_ENTRY), 'testing'));
    store.dispatch(
      cloudMachineOperationSettled(cloudValidateKey(NEW_CLOUD_ENTRY), {
        message: 'Northflank rejected the API token',
        cloud: {
          code: 'cloud-machine-unavailable',
          reason: 'key-rejected',
          retryable: false,
          provider: 'northflank',
        },
      }),
    );
  }
  if (state === 'entries-rename-taken') {
    store.dispatch(cloudMachineOperationStarted(cloudConfigureKey(TEAM_ENTRY.id), 'saving'));
    store.dispatch(
      cloudMachineOperationSettled(cloudConfigureKey(TEAM_ENTRY.id), {
        message: 'Another E2B entry is named "E2B".',
      }),
    );
  }
  if (state === 'remove-in-use') {
    store.dispatch(cloudMachineOperationStarted(cloudRemoveKey('e2b'), 'removing'));
    store.dispatch(
      cloudMachineOperationSettled(cloudRemoveKey('e2b'), {
        message: 'E2B has 3 sandboxes with agents. Stop them first, or remove with stopAgents.',
        inUse: true,
      }),
    );
  }
  // The profiler's agent is being deleted; its sandbox still lists until the backend removes it.
  const grouped = state === 'sandboxes-grouped' || state === 'sandboxes-collapsed';
  if (grouped) setPendingAgentDeletion({ wsId: 'ws-perf', agentId: 'agent-sb-3' });
  if (state === 'sandboxes-collapsed')
    collapsedSandboxGroups.add(sandboxGroupId(E2B_PROVIDER.name, 'ws-ci'));
  return () => {
    collapsedSandboxGroups.clear();
    if (grouped) removePendingAgentDeletion('agent-sb-3');
    for (const workspace of WORKSPACES) store.dispatch(removeWorkspaceEntity(workspace.id));
    store.dispatch(setLabsCloudMachinesEnabled(previousCloudLabs));
    restoreRemote();
  };
}

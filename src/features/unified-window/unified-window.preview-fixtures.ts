import { catalogNow } from '$lib/component-catalog/catalog-clock';
import { WorkspaceStatus, type Workspace, type WorkspaceDisplayStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { UnifiedMachine } from './unified-machines';

export const LOCAL: UnifiedMachine = {
  id: 'local',
  label: 'This Mac',
  kind: 'local',
  accent: null,
  icon: { detectedDeviceKind: 'laptop' },
  online: true,
};
export const STUDIO: UnifiedMachine = {
  id: 'studio',
  label: 'Mac Studio',
  kind: 'remote',
  accent: 'violet',
  icon: { detectedDeviceKind: 'macStudio' },
  online: true,
};
export const GUEST: UnifiedMachine = {
  id: 'guest-ana',
  label: 'Ana’s MacBook Pro',
  kind: 'guest',
  accent: null,
  icon: { detectedDeviceKind: 'laptop' },
  online: true,
};
export const BUILD_BOX: UnifiedMachine = {
  id: 'build-box',
  label: 'Build box',
  kind: 'remote',
  accent: 'teal',
  icon: { detectedDeviceKind: 'server' },
  online: false,
};

export const MACHINES = [LOCAL, STUDIO, GUEST, BUILD_BOX];

/** Shell tab key; the real shell keys tabs by (machine, workspace id). */
export const tabKey = (machine: UnifiedMachine, workspaceId: string) =>
  `${machine.id}--${workspaceId}`;

interface WorkspaceFixture {
  machine: UnifiedMachine;
  id: string;
  title: string;
  repository: string;
  displayStatus: WorkspaceDisplayStatus;
  statusMessage: string;
  minutesAgo: number;
}

const fixture = (
  machine: UnifiedMachine,
  id: string,
  title: string,
  repository: string,
  displayStatus: WorkspaceDisplayStatus,
  statusMessage: string,
  minutesAgo: number,
): WorkspaceFixture => ({
  machine,
  id,
  title,
  repository,
  displayStatus,
  statusMessage,
  minutesAgo,
});

export const WORKSPACES: WorkspaceFixture[] = [
  fixture(
    LOCAL,
    'onboarding',
    'Review the new onboarding flow',
    'studio',
    'needs_attention',
    'Ready for review: keyboard navigation and empty states.',
    4,
  ),
  fixture(
    STUDIO,
    'deploy',
    'Deploy pipeline for previews',
    'platform',
    'in_progress',
    'Wiring preview deploys into the release workflow.',
    2,
  ),
  fixture(
    STUDIO,
    'gpu',
    'GPU benchmark suite',
    'platform',
    'idle',
    'Benchmarks finished; results are in the notes.',
    48,
  ),
  fixture(
    GUEST,
    'tokens',
    'Design tokens for the deploy page',
    'design-system',
    'pr_ready',
    'Pull request is ready for review.',
    15,
  ),
  fixture(
    BUILD_BOX,
    'nightly',
    'Deploy nightly CI fixes',
    'platform',
    'in_progress',
    'Retrying the flaky integration jobs.',
    180,
  ),
  fixture(LOCAL, 'docs', 'Deploy docs site', 'studio', 'complete', 'Docs site is live.', 90),
  fixture(
    BUILD_BOX,
    'cache',
    'Warm the build cache',
    'platform',
    'idle',
    'Cache warmed for the main branch.',
    300,
  ),
];

export function toWorkspace(item: WorkspaceFixture): Workspace {
  const updatedAt = new Date(catalogNow() - item.minutesAgo * 60_000).toISOString();
  return {
    id: WorkspaceId(tabKey(item.machine, item.id)),
    title: item.title,
    branch: `feat/${item.id}`,
    baseRef: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: item.displayStatus,
    statusMessage: item.statusMessage,
    repositoryOwner: 'acme',
    repositoryName: item.repository,
    repositoryPath: `/repos/${item.repository}`,
    createdAt: updatedAt,
    updatedAt,
  };
}

/** Machine for a fixture tab key, with an optional set of machines forced offline. */
export function machineForKey(key: string, offline: readonly string[] = []) {
  const machine = MACHINES.find((candidate) => key.startsWith(`${candidate.id}--`)) ?? null;
  if (!machine) return null;
  return offline.includes(machine.id) ? { ...machine, online: false } : machine;
}

export const SAVED_CONNECTIONS: ConnectionRecord[] = [
  {
    id: 'local',
    label: 'This machine',
    host: null,
    port: null,
    fingerprint: null,
    isLocal: true,
    status: 'connected',
    detectedDeviceKind: 'laptop',
  },
  {
    id: 'studio',
    label: 'Mac Studio',
    host: '192.0.2.4',
    port: 5179,
    fingerprint: 'AA:BB',
    isLocal: false,
    status: 'connected',
    accent: 'violet',
    detectedDeviceKind: 'macStudio',
  },
  {
    id: 'build-box',
    label: 'Build box',
    host: '192.0.2.10',
    port: 5179,
    fingerprint: 'BB:01',
    isLocal: false,
    status: 'disconnected',
    accent: 'teal',
    detectedDeviceKind: 'server',
  },
];

export const GUEST_SESSION: GuestSessionRecord = {
  id: 'guest-ana',
  label: 'ana.tc.example',
  host: '192.0.2.30',
  hosts: ['192.0.2.30'],
  port: 5181,
  fingerprint: 'CC:DD',
  tcAddress: null,
  hostname: 'Ana’s MacBook Pro',
  principalId: 'principal-guest',
  login: 'ana',
  tokenEncrypted: true,
  workspaces: [],
  updatedAt: Date.parse('2026-11-01T12:00:00.000Z'),
};

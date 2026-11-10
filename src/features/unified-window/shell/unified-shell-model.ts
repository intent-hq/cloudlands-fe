/**
 * Pure model of the Unified window shell: which machines exist, which workspace
 * entities back the mixed tab strip, which machine view shows the selection, and
 * how the shell's tab state maps to the persisted restore record.
 */
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { ConnectionRecord } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { PersistedWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
import { formatConnectionLabel, formatGuestSessionLabel } from '$lib/utils/connection-label';
import { resolveConnectionAccent } from '$lib/utils/connection-accents';
import type { UnifiedMachineFeed } from '../unified-feed-types';
import type { UnifiedMachine } from '../unified-machines';
import {
  parseUnifiedTabKey,
  unifiedTabKey,
  type UnifiedWindowState,
} from '../unified-window-state';

export function buildUnifiedMachines(input: {
  connections: ConnectionRecord[];
  connectedIds: string[];
  guestSessions: GuestSessionRecord[];
  guestConnectedIds: string[];
  localLabel?: string;
}): UnifiedMachine[] {
  const connected = new Set([...input.connectedIds, ...input.guestConnectedIds]);
  const saved = input.connections
    .filter((connection) => connection.daemonMode !== 'node')
    .sort((a, b) => Number(b.isLocal) - Number(a.isLocal))
    .map(
      (connection): UnifiedMachine => ({
        id: connection.id,
        label: connection.isLocal
          ? connection.machineName?.trim() || input.localLabel || connection.label
          : formatConnectionLabel(connection),
        kind: connection.isLocal ? 'local' : 'remote',
        accent: connection.isLocal ? null : resolveConnectionAccent(connection.accent),
        icon: connection,
        online: connected.has(connection.id),
      }),
    );
  const guests = input.guestSessions.map(
    (session): UnifiedMachine => ({
      id: session.id,
      label: formatGuestSessionLabel(session),
      kind: 'guest',
      accent: null,
      icon: {},
      online: connected.has(session.id),
    }),
  );
  return [...saved, ...guests];
}

/** Workspace entities for the shell store, keyed by (machine, workspace). */
export function feedEntities(feeds: UnifiedMachineFeed[]): Workspace[] {
  return feeds.flatMap((feed) =>
    feed.rows.map(
      (row) =>
        ({
          ...row,
          id: WorkspaceId(unifiedTabKey(feed.machineId, row.id)),
          title: row.title,
          status: (row.status as Workspace['status']) ?? WorkspaceStatus.Active,
          changesets: [],
          timeline: [],
          conversationInfo: [],
          createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
        }) as Workspace,
    ),
  );
}

/** Open tabs per machine (workspace ids in strip order), for each machine view. */
export function tabsByMachine(tabKeys: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const key of tabKeys) {
    const ref = parseUnifiedTabKey(key);
    if (!ref) continue;
    (result[ref.machineId] ??= []).push(ref.workspaceId);
  }
  return result;
}

/**
 * Tabs whose workspace was deleted on its machine. Only a fresh (connected) list
 * counts: an offline machine's cached list may be out of date.
 */
export function tabsToCloseForDeletedWorkspaces(
  tabKeys: string[],
  feeds: UnifiedMachineFeed[],
): string[] {
  const fresh = new Map(
    feeds
      .filter((feed) => !feed.stale)
      .map((feed) => [feed.machineId, new Set(feed.rows.map((row) => row.id))]),
  );
  return tabKeys.filter((key) => {
    const ref = parseUnifiedTabKey(key);
    const ids = ref ? fresh.get(ref.machineId) : undefined;
    return !!ref && !!ids && !ids.has(ref.workspaceId);
  });
}

export type ShellSelection =
  | { kind: 'view'; machineId: string; route: string }
  | { kind: 'offline'; machine: UnifiedMachine };

/** What the content area shows for the selected tab, or Home / Settings on the dropdown machine. */
export function shellSelection(
  activeTabKey: string | null,
  page: 'home' | 'settings',
  dropdownMachineId: string,
  machines: UnifiedMachine[],
): ShellSelection {
  const ref = activeTabKey ? parseUnifiedTabKey(activeTabKey) : null;
  if (!ref) return { kind: 'view', machineId: dropdownMachineId, route: page === 'settings' ? '/settings' : '/' };
  const machine = machines.find((candidate) => candidate.id === ref.machineId);
  if (machine && !machine.online) return { kind: 'offline', machine };
  return {
    kind: 'view',
    machineId: ref.machineId,
    route: `/workspace/${encodeURIComponent(ref.workspaceId)}`,
  };
}

export function recordFromTabState(
  tabs: PersistedWorkspaceTabsState,
  dropdownMachineId: string,
): UnifiedWindowState {
  return {
    version: 1,
    tabKeys: tabs.tabOrder,
    pinnedTabKeys: tabs.pinnedTabs,
    activeTabKey: tabs.currentTabId,
    groups: (tabs.tabGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      tabKeys: group.workspaceIds,
    })),
    openGroupId: tabs.openTabGroupId ?? null,
    dropdownMachineId,
  };
}

export function tabStateFromRecord(record: UnifiedWindowState): PersistedWorkspaceTabsState {
  return {
    openTabs: record.tabKeys,
    currentTabId: record.activeTabKey,
    pinnedTabs: record.pinnedTabKeys,
    unsavedTabs: [],
    optimisticTabs: [],
    tabOrder: record.tabKeys,
    tabGroups: record.groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      workspaceIds: group.tabKeys,
    })),
    openTabGroupId: record.openGroupId,
  };
}

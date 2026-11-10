/**
 * Unified window restore record and tab keys, shared by main and the shell renderer.
 *
 * Workspace ids are unique only per machine, so every Unified tab is keyed by
 * (machine, workspace). The key encodes both parts with `encodeURIComponent` and
 * joins them with `|`, which an encoded part never contains, so it always splits back.
 */
import type { WorkspaceTabGroupColor } from '$store/renderer/slices/tab-state/tab-groups';

export interface UnifiedTabRef {
  machineId: string;
  workspaceId: string;
}

export interface UnifiedTabGroupRecord {
  id: string;
  name: string;
  color: WorkspaceTabGroupColor;
  /** Tab keys, in strip order. */
  tabKeys: string[];
}

export interface UnifiedWindowState {
  version: 1;
  /** Tab keys in strip order. */
  tabKeys: string[];
  pinnedTabKeys: string[];
  /** Selected tab key; null shows Home on the dropdown machine. */
  activeTabKey: string | null;
  groups: UnifiedTabGroupRecord[];
  openGroupId: string | null;
  /** The machine powering Home, Assistant, PRs, Linear and Settings. */
  dropdownMachineId: string;
}

export const EMPTY_UNIFIED_WINDOW_STATE: UnifiedWindowState = {
  version: 1,
  tabKeys: [],
  pinnedTabKeys: [],
  activeTabKey: null,
  groups: [],
  openGroupId: null,
  dropdownMachineId: 'local',
};

const SEPARATOR = '|';

export function unifiedTabKey(machineId: string, workspaceId: string): string {
  return `${encodeURIComponent(machineId)}${SEPARATOR}${encodeURIComponent(workspaceId)}`;
}

export function parseUnifiedTabKey(key: string): UnifiedTabRef | null {
  const parts = key.split(SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    return {
      machineId: decodeURIComponent(parts[0]),
      workspaceId: decodeURIComponent(parts[1]),
    };
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Read a persisted record, dropping malformed parts; null when nothing usable is there. */
export function parseUnifiedWindowState(raw: unknown): UnifiedWindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (source.version !== 1) return null;
  const tabKeys = [...new Set(stringArray(source.tabKeys).filter((key) => parseUnifiedTabKey(key)))];
  const open = new Set(tabKeys);
  const groups = (Array.isArray(source.groups) ? source.groups : [])
    .map((group) => group as Record<string, unknown>)
    .filter((group) => typeof group?.id === 'string' && typeof group.color === 'string')
    .map((group) => ({
      id: group.id as string,
      name: typeof group.name === 'string' ? group.name : '',
      color: group.color as WorkspaceTabGroupColor,
      tabKeys: stringArray(group.tabKeys).filter((key) => open.has(key)),
    }))
    .filter((group) => group.tabKeys.length > 0);
  const activeTabKey =
    typeof source.activeTabKey === 'string' && open.has(source.activeTabKey)
      ? source.activeTabKey
      : null;
  const openGroupId =
    typeof source.openGroupId === 'string' && groups.some((group) => group.id === source.openGroupId)
      ? source.openGroupId
      : null;
  return {
    version: 1,
    tabKeys,
    pinnedTabKeys: stringArray(source.pinnedTabKeys).filter((key) => open.has(key)),
    activeTabKey,
    groups,
    openGroupId,
    dropdownMachineId:
      typeof source.dropdownMachineId === 'string' && source.dropdownMachineId
        ? source.dropdownMachineId
        : 'local',
  };
}

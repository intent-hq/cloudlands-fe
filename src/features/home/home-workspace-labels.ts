import type { Workspace } from '$shared/types';
import { isPinnedWorkspaceLabel } from '$store/renderer/slices/sidebar-nav/workspace-labels';
import type { HomeFilter } from './home-model';
import type { HomeConfiguration } from './home-workspaces-persistence';

/** Home list expansion key for a custom label group. */
export function homeLabelGroupKey(label: string): string {
  return `label:${label}`;
}

export interface HomeListGroup {
  id: string;
  label: string;
  items: Workspace[];
  expanded: boolean;
  collapsible: boolean;
}

interface HomeListGroupInput {
  groupBy: HomeConfiguration['groupBy'];
  filter: HomeFilter;
  /** Status, activity or repository groups, before pinned/labeled rows are removed. */
  baseGroups: readonly { id: string; label: string; items: Workspace[] }[];
  /** Visible workspaces in list order; group contents keep this order. */
  workspaces: readonly Workspace[];
  pinnedIds: readonly string[];
  /** Custom labels in use A–Z (`selectWorkspaceLabelsInUse`); their spelling names the groups. */
  labels: readonly string[];
  /** Whether the daemon serves labels; older daemons get no custom label groups. */
  labelsSupported: boolean;
  pinnedLabel: string;
  expandedGroups: Readonly<Record<string, boolean>>;
  selectedId: string | null;
}

/** Custom (non-Pinned) label of a workspace, trimmed, or null. */
function customLabel(workspace: Workspace): string | null {
  const label = workspace.label?.trim();
  return label && !isPinnedWorkspaceLabel(workspace.label) ? label : null;
}

/**
 * Collapsible Home list groups: Pinned first, then one group per custom label
 * in use (in `labels` order, matched ignoring case), then `baseGroups` without those rows. Group
 * by None, and Activity grouping under a status filter, show no groups.
 */
export function buildHomeListGroups(input: HomeListGroupInput): HomeListGroup[] {
  const { groupBy, filter, workspaces, pinnedIds, labelsSupported, expandedGroups, selectedId } =
    input;
  if (groupBy === 'none' || (groupBy === 'status' && filter !== 'all')) return [];
  const group = (id: string, label: string, items: Workspace[]): HomeListGroup => ({
    id,
    label,
    items,
    expanded: expandedGroups[id] !== false || items.some((item) => item.id === selectedId),
    collapsible: true,
  });
  const pinned = new Set(pinnedIds);
  const labeled = new Map<string, Workspace[]>();
  const grouped = new Set<string>();
  for (const workspace of workspaces) {
    if (pinned.has(workspace.id)) {
      grouped.add(workspace.id);
      continue;
    }
    const label = labelsSupported ? customLabel(workspace) : null;
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    labeled.set(key, [...(labeled.get(key) ?? []), workspace]);
    grouped.add(workspace.id);
  }
  const pinnedItems = workspaces.filter((workspace) => pinned.has(workspace.id));
  return [
    ...(pinnedItems.length ? [group('pinned', input.pinnedLabel, pinnedItems)] : []),
    ...input.labels.flatMap((label) => {
      const items = labeled.get(label.trim().toLocaleLowerCase());
      return items ? [group(homeLabelGroupKey(label), label, items)] : [];
    }),
    ...input.baseGroups.flatMap((base) => {
      const items = base.items.filter((workspace) => !grouped.has(workspace.id));
      return items.length ? [group(base.id, base.label, items)] : [];
    }),
  ];
}

/**
 * Pure result-building logic for the CommandPalette.
 * Extracted from the component so it is testable outside Svelte.
 */

import {
  fuzzyScore,
  scoreItemFields,
  type PaletteFilter,
  type WorkspaceObject,
  type WorkspaceObjectType,
} from './command-palette-utils';
import { m } from '$shared/paraglide/messages.js';

interface PaletteCommand {
  id: string;
  label: string;
  pillLabel?: string;
  icon: any;
  shortcut?: string;
  searchText?: string;
  navigationIcon?: 'spaces' | 'tabs';
}

interface WorkspaceItem {
  id: string;
  label: string;
  icon: any;
  description?: string;
  _workspace: true;
  _time?: string;
  /** Raw last-activity timestamp (ms) used as a search-ranking tiebreak. */
  _activityTime?: number;
}

export interface ComputeResultsInput {
  query: string;
  activeFilter: PaletteFilter | null;
  workspaceId: string | undefined;
  agents: WorkspaceObject[];
  notes: WorkspaceObject[];
  changes: WorkspaceObject[];
  terminals: WorkspaceObject[];
  browserUrls: WorkspaceObject[];
  recentItems: WorkspaceObject[];
  files: any[];
  commands: PaletteCommand[];
  workspaceItems: WorkspaceItem[];
  /** Chat transcript matches from `search.messages` (already query-driven and capped). */
  messages?: any[];
}

const MAX_ITEMS_PER_GROUP = 3;
const MAX_SEARCH_ITEMS_PER_GROUP = 5;

/**
 * Build the flat list of palette results.
 * This is a pure function — no side effects, no DOM, no stores.
 */
export function computeResults(input: ComputeResultsInput): any[] {
  const {
    query: q,
    activeFilter,
    workspaceId,
    agents,
    notes,
    changes,
    terminals,
    browserUrls,
    recentItems,
    files,
    commands,
    workspaceItems,
    messages = [],
  } = input;

  const flat: any[] = [];
  let idx = 0;

  const addItems = (
    items: any[],
    groupLabel?: string,
    shortcutKey?: string,
    itemType?: WorkspaceObjectType | 'message',
  ) => {
    if (groupLabel && items.length > 0) {
      flat.push({ _groupLabel: groupLabel, _shortcutKey: shortcutKey, _idx: idx++ });
    }

    const shouldLimit = !q && (!activeFilter || activeFilter !== itemType);
    const itemsToShow = shouldLimit ? items.slice(0, MAX_ITEMS_PER_GROUP) : items;

    for (const item of itemsToShow) {
      flat.push({ ...item, _idx: idx++ });
    }

    if (shouldLimit && items.length > MAX_ITEMS_PER_GROUP && itemType) {
      flat.push({
        _showMore: true,
        _itemType: itemType,
        _count: items.length - MAX_ITEMS_PER_GROUP,
        _idx: idx++,
      });
    }
  };

  // Searching: show per-class groups, each ranked by its own algorithm
  if (q) {
    // With the message filter active, show only the transcript matches.
    if (activeFilter === 'message') {
      addItems(messages, m.layout_commandPalette_messages_group(), '?', 'message');
      return flat;
    }

    const rank = (items: any[], tiebreak?: (a: any, b: any) => number): any[] =>
      items
        .map((item: any) => ({
          item,
          score: scoreItemFields(
            { label: item.label, description: item.description, searchText: item.searchText },
            q,
          ),
        }))
        .filter((entry) => entry.score !== -Infinity)
        .sort((a, b) => b.score - a.score || (tiebreak ? tiebreak(a.item, b.item) : 0))
        .map((entry) => entry.item);

    const byActivityDesc = (a: WorkspaceItem, b: WorkspaceItem) =>
      (b._activityTime ?? 0) - (a._activityTime ?? 0);

    const searchCommands = commands.filter(
      (c) => c.id !== 'new-workspace' && (workspaceId || c.id !== 'new-file'),
    );

    // Files keep their incoming order (already fuzzy+MRU ranked upstream) but
    // are re-checked against the current query: they load asynchronously, so
    // the incoming list can be stale for a beat after the query changes. The
    // guard drops entries that no longer match without reordering the rest
    // (fresh results always pass — queryFiles filters on the same predicate).
    // Messages are already FTS-ranked and capped by the transcript search.
    const currentFiles = files.filter(
      (f: any) => fuzzyScore(`${f.label} ${f.description || ''}`, q) !== -Infinity,
    );
    const groups: Array<{
      filter: PaletteFilter | null;
      items: () => any[];
      label: string;
      shortcutKey?: string;
    }> = [
      {
        filter: null,
        items: () => rank(searchCommands),
        label: m.layout_commandPalette_commands_group(),
      },
      {
        filter: 'agent',
        items: () => rank(agents),
        label: m.layout_commandPalette_agents_group(),
        shortcutKey: '@',
      },
      {
        filter: 'note',
        items: () => rank(notes),
        label: m.layout_commandPalette_context_group(),
        shortcutKey: '#',
      },
      {
        filter: 'change',
        items: () => rank(changes),
        label: m.layout_commandPalette_changes_group(),
        shortcutKey: '~',
      },
      {
        filter: 'terminal',
        items: () => rank(terminals),
        label: m.layout_commandPalette_terminals_group(),
        shortcutKey: '>',
      },
      {
        filter: 'browser',
        items: () => rank(browserUrls),
        label: m.layout_commandPalette_browser_group(),
        shortcutKey: '^',
      },
      {
        filter: 'file',
        items: () => currentFiles,
        label: m.layout_commandPalette_files_group(),
        shortcutKey: '/',
      },
      {
        filter: 'workspace',
        items: () => rank(workspaceItems, byActivityDesc),
        label: m.layout_commandPalette_otherSpaces_group(),
        shortcutKey: '*',
      },
      {
        filter: 'message',
        items: () => messages,
        label: m.layout_commandPalette_messages_group(),
        shortcutKey: '?',
      },
    ];

    for (const group of groups) {
      if (activeFilter) {
        // A class filter shows only that class's group, uncapped.
        if (group.filter !== activeFilter) continue;
        addItems(group.items(), group.label, group.shortcutKey);
      } else {
        addItems(
          group.items().slice(0, MAX_SEARCH_ITEMS_PER_GROUP),
          group.label,
          group.shortcutKey,
        );
      }
    }
    return flat;
  }

  // Not searching — show organized groups
  const newWs = commands.find((c) => c.id === 'new-workspace');
  const newActions = workspaceId
    ? commands.filter((c) => ['new-agent', 'new-terminal', 'new-note', 'new-file'].includes(c.id))
    : [];

  if (!activeFilter && (newActions.length > 0 || newWs)) {
    flat.push({ _newActionsRow: true, _idx: idx++ });
    for (const action of newActions) {
      flat.push({ ...action, _idx: idx++, _newAction: true });
    }
    if (newWs) {
      flat.push({ ...newWs, _idx: idx++, _newAction: true, _newWorkspace: true });
    }
  }

  if (recentItems.length > 0 && !activeFilter)
    addItems(recentItems, m.layout_commandPalette_recent_group());
  if (agents.length > 0 && (!activeFilter || activeFilter === 'agent'))
    addItems(agents, m.layout_commandPalette_agents_group(), '@', 'agent');
  if (notes.length > 0 && (!activeFilter || activeFilter === 'note'))
    addItems(notes, m.layout_commandPalette_context_group(), '#', 'note');
  if (changes.length > 0 && (!activeFilter || activeFilter === 'change'))
    addItems(changes, m.layout_commandPalette_changes_group(), '~', 'change');
  if (terminals.length > 0 && (!activeFilter || activeFilter === 'terminal'))
    addItems(terminals, m.layout_commandPalette_terminals_group(), '>', 'terminal');
  if (browserUrls.length > 0 && (!activeFilter || activeFilter === 'browser'))
    addItems(browserUrls, m.layout_commandPalette_browser_group(), '^', 'browser');
  if (files.length > 0 && (!activeFilter || activeFilter === 'file'))
    addItems(files, m.layout_commandPalette_files_group(), '/', 'file');
  if (messages.length > 0 && (!activeFilter || activeFilter === 'message'))
    addItems(messages, m.layout_commandPalette_messages_group(), '?', 'message');

  if (!activeFilter || activeFilter === 'workspace') {
    if (workspaceItems.length > 0) {
      flat.push({ _borderAbove: true, _idx: idx++ });
      addItems(workspaceItems, m.layout_commandPalette_otherSpaces_group(), '*');
    }
  }

  return flat;
}

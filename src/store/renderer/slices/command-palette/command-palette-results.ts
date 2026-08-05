/**
 * Pure result-building logic for the CommandPalette.
 * Extracted from the component so it is testable outside Svelte.
 */

import {
  fuzzyScore,
  type PaletteFilter,
  type WorkspaceObject,
  type WorkspaceObjectType,
} from './command-palette-utils';
import { m } from '$shared/paraglide/messages.js';

export interface PaletteCommand {
  id: string;
  label: string;
  pillLabel?: string;
  icon: any;
  shortcut?: string;
}

export interface WorkspaceItem {
  id: string;
  label: string;
  icon: any;
  description?: string;
  _workspace: true;
  _time?: string;
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

  // Searching: show filtered results across all types
  if (q) {
    // With the message filter active, show only the transcript matches.
    if (activeFilter === 'message') {
      addItems(messages, m.layout_commandPalette_messages_group(), '?', 'message');
      return flat;
    }

    const allItems = [
      ...commands.filter((c) => c.id !== 'new-workspace' && (workspaceId || c.id !== 'new-file')),
      ...agents,
      ...notes,
      ...changes,
      ...terminals,
      ...browserUrls,
      ...files,
      ...workspaceItems,
    ];

    const filtered = allItems
      .map((item: any) => ({
        ...item,
        _score: fuzzyScore(`${item.label} ${item.description || ''}`, q),
      }))
      .filter((item: any) => item._score !== -Infinity)
      .sort((a: any, b: any) => (b._score as number) - (a._score as number))

      .map(({ _score, ...rest }: any) => rest)
      .slice(0, 20);

    addItems(filtered);
    // Transcript matches are already query-driven (FTS) — append as their own
    // labeled group rather than re-filtering them through fuzzyScore.
    if (messages.length > 0) {
      addItems(messages, m.layout_commandPalette_messages_group(), '?', 'message');
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

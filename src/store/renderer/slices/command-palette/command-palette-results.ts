/**
 * Pure result-building logic for the CommandPalette.
 * Extracted from the component so it is testable outside Svelte.
 */

import {
  fuzzyScore,
  isExactNameMatch,
  matchTier,
  MATCH_TIER,
  normalizeQuery,
  scoreItemFields,
  type PaletteFilter,
  type WorkspaceObject,
  type WorkspaceObjectType,
} from './command-palette-utils';
import type { PalettePick } from '../palette/palette-pick-memory';
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
  /** Archived workspace whose folder was purged (`Retired`, PROTOCOL §5.1):
   *  search opts in and shows the Archived badge. */
  isRetiredWorkspace?: boolean;
  _time?: string;
  /** Raw last-activity timestamp (ms) used as a search-ranking tiebreak. */
  _activityTime?: number;
}

/** A known repo (or Labs plain folder) as a palette row. */
export interface PaletteRepoItem {
  /** Unique per row: a local clone and its GitHub entry have different ids. */
  id: string;
  /** Display name, e.g. "owner/name". */
  label: string;
  /** Other primary names to match: repo name, folder name. */
  aliases?: string[];
  /** Source label or folder path (secondary match field). */
  description?: string;
  kind: 'repo' | 'folder';
  lastUsedAt?: number;
  icon?: any;
  [extra: string]: unknown;
}


/** Results that arrive from the server after typing. */
export type PaletteLateSource = 'file' | 'note' | 'message';

/** Category of a palette row; the UI maps it to the row's category label. */
export type PaletteCategory =
  | 'command'
  | 'agent'
  | 'note'
  | 'change'
  | 'terminal'
  | 'browser'
  | 'file'
  | 'workspace'
  | 'repo'
  | 'folder'
  | 'message';

export interface ComputeResultsInput {
  query: string;
  activeFilter: PaletteFilter | null;
  workspaceId: string | undefined;
  agents: WorkspaceObject[];
  notes: WorkspaceObject[];
  /** Indexed note hits, already query-driven and in server relevance order. */
  indexedNotes?: WorkspaceObject[];
  changes: WorkspaceObject[];
  terminals: WorkspaceObject[];
  browserUrls: WorkspaceObject[];
  recentItems: WorkspaceObject[];
  files: any[];
  commands: PaletteCommand[];
  workspaceItems: WorkspaceItem[];
  /** Chat transcript matches from `search.messages` (already query-driven and capped). */
  messages?: any[];
  /** Known repos; omit (or pass []) when New Workspace is hidden. */
  repos?: PaletteRepoItem[];
  /** Remembered query → item picks (any order). */
  pickMemory?: readonly PalettePick[];
  /** Order in which late sources returned results for the current query. */
  lateArrivalOrder?: PaletteLateSource[];
  /** Clock for pick fading (ms); defaults to `Date.now()`. */
  now?: number;
}

const MAX_ITEMS_PER_GROUP = 3;
/** About how many rows the blended list shows. */
export const MAX_BLENDED_ROWS = 15;
/** Server-only note hits and chat messages each take at most this many blended rows. */
export const MAX_BLENDED_SERVER_ROWS = 3;
const PICK_FADE_MS = 30 * 24 * 60 * 60 * 1000;

const OBJECT_TYPES = new Set<string>(['agent', 'note', 'change', 'terminal', 'file', 'browser']);

function repoCategory(repo: PaletteRepoItem): PaletteCategory {
  return repo.kind === 'folder' ? 'folder' : 'repo';
}

/**
 * Stable identity of a palette row, used for pick memory and for keeping the
 * highlight on the same item while results change.
 */
function paletteItemKey(
  category: PaletteCategory,
  item: any,
  workspaceId: string | undefined,
): string {
  switch (category) {
    case 'note':
      return `note:${item.workspaceId ?? workspaceId ?? ''}:${item.noteId ?? item.id}`;
    case 'file':
      return `file:${item.path ?? item.id}`;
    case 'folder':
      return `repo:${item.id}`;
    default:
      return `${category}:${item.id}`;
  }
}

function inferCategory(item: any): PaletteCategory {
  if (item._workspace) return 'workspace';
  if (item.type === 'message') return 'message';
  if (OBJECT_TYPES.has(item.type)) return item.type;
  if (item.kind === 'repo' || item.kind === 'folder') return item.kind;
  if (typeof item.path === 'string') return 'file';
  return 'command';
}

function toRow(item: any, category: PaletteCategory, workspaceId: string | undefined, idx: number) {
  return {
    ...item,
    _idx: idx,
    _key: paletteItemKey(category, item, workspaceId),
    _category: category,
  };
}

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
    repos = [],
  } = input;

  if (q) return rankResults(input);

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

    const shouldLimit = !activeFilter || activeFilter !== itemType;
    const itemsToShow = shouldLimit ? items.slice(0, MAX_ITEMS_PER_GROUP) : items;

    for (const item of itemsToShow) {
      flat.push(toRow(item, inferCategory(item), workspaceId, idx++));
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

  // `+` alone: every palette repo, most recent first.
  if (activeFilter === 'repo') {
    for (const repo of [...repos].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))) {
      flat.push(toRow(repo, repoCategory(repo), workspaceId, idx++));
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
      flat.push({ ...toRow(action, 'command', workspaceId, idx++), _newAction: true });
    }
    if (newWs) {
      flat.push({
        ...toRow(newWs, 'command', workspaceId, idx++),
        _newAction: true,
        _newWorkspace: true,
      });
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

// ── Blended ranking (query typed) ──────────────────────────────────────────

interface Candidate {
  item: any;
  category: PaletteCategory;
  key: string;
  exact: boolean;
  exactPick: number;
  tier: number;
  relatedPick: number;
  recency: number;
  fine: number;
}

/** Tier order: exact name, exact-query pick, match tier, related pick, recency, fine score. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    Number(b.exact) - Number(a.exact) ||
    b.exactPick - a.exactPick ||
    b.tier - a.tier ||
    b.relatedPick - a.relatedPick ||
    b.recency - a.recency ||
    b.fine - a.fine
  );
}

function pickWeights(picks: readonly PalettePick[], normalizedQuery: string, now: number) {
  const exact = new Map<string, number>();
  const related = new Map<string, number>();
  for (const pick of picks) {
    const weight = 1 - (now - pick.timestamp) / PICK_FADE_MS;
    if (!(weight > 0)) continue;
    const pickQuery = normalizeQuery(pick.query);
    if (!pickQuery) continue;
    const target =
      pickQuery === normalizedQuery
        ? exact
        : pickQuery.startsWith(normalizedQuery) || normalizedQuery.startsWith(pickQuery)
          ? related
          : null;
    if (target) target.set(pick.itemKey, (target.get(pick.itemKey) ?? 0) + Math.min(weight, 1));
  }
  return { exact, related };
}

/**
 * Last used / last active time. Recency is the last tier, so any decay curve
 * would order items the same way as the raw timestamp: compare it directly.
 */
function itemTimestamp(item: any): number {
  return item.timestamp ?? item._activityTime ?? item.lastUsedAt ?? 0;
}

function rankResults(input: ComputeResultsInput): any[] {
  const {
    query: q,
    activeFilter,
    workspaceId,
    agents,
    notes,
    indexedNotes = [],
    changes,
    terminals,
    browserUrls,
    files,
    commands,
    workspaceItems,
    messages = [],
    repos = [],
    pickMemory = [],
    lateArrivalOrder = [],
    now = Date.now(),
  } = input;
  const nq = normalizeQuery(q);
  const picks = pickWeights(pickMemory, nq, now);

  const candidate = (item: any, category: PaletteCategory): Candidate | null => {
    const names: string[] = [item.label ?? '', ...((item.aliases as string[] | undefined) ?? [])];
    const exact = isExactNameMatch(names, nq);
    const tier = exact
      ? MATCH_TIER.startsWith
      : matchTier({ names, secondary: [item.description, item.searchText, item.path] }, nq);
    if (tier === MATCH_TIER.none) return null;
    const key = paletteItemKey(category, item, workspaceId);
    const fine = scoreItemFields(
      { label: names.join(' '), description: item.description, searchText: item.searchText },
      q,
    );
    return {
      item,
      category,
      key,
      exact,
      exactPick: picks.exact.get(key) ?? 0,
      tier,
      relatedPick: picks.related.get(key) ?? 0,
      recency: itemTimestamp(item),
      fine: Number.isFinite(fine) ? fine : 0,
    };
  };
  const rank = (items: any[], category: PaletteCategory | ((item: any) => PaletteCategory)) =>
    items
      .map((item) => candidate(item, typeof category === 'function' ? category(item) : category))
      .filter((c): c is Candidate => c !== null)
      .sort(compareCandidates);

  // Files load asynchronously, so the incoming list can be stale for a beat
  // after the query changes: drop entries that no longer match.
  const currentFiles = files.filter(
    (f: any) => fuzzyScore(`${f.label} ${f.description || ''}`, q) !== -Infinity,
  );
  const rankFiles = (): Candidate[] =>
    currentFiles
      .map(
        (file: any) =>
          candidate(file, 'file') ?? {
            item: file,
            category: 'file' as const,
            key: paletteItemKey('file', file, workspaceId),
            exact: false,
            exactPick: 0,
            tier: MATCH_TIER.secondaryLoose,
            relatedPick: 0,
            recency: 0,
            fine: 0,
          },
      )
      .sort(compareCandidates);

  // Server note hits are never dropped by the client: a hit whose local note
  // matched by title shows as that local row; the rest keep server order.
  // A matched local note shows the server hit's fields (e.g. its body snippet).
  const localNotes = rank(notes, 'note');
  const localNoteByKey = new Map(localNotes.map((c) => [c.key, c]));
  const seenServerNotes = new Set<string>();
  const serverNotes = indexedNotes.filter((note) => {
    const key = paletteItemKey('note', note, workspaceId);
    if (seenServerNotes.has(key)) return false;
    seenServerNotes.add(key);
    const local = localNoteByKey.get(key);
    if (local) local.item = note;
    return !local;
  });

  const searchCommands = commands.filter((c) => workspaceId || c.id !== 'new-file');

  const flat: any[] = [];
  const push = (item: any, category: PaletteCategory) =>
    flat.push(toRow(item, category, workspaceId, flat.length));
  const pushRanked = (ranked: Candidate[]) => ranked.forEach((c) => push(c.item, c.category));

  // A category filter shows the same items as before, in ranking order, uncapped.
  if (activeFilter) {
    switch (activeFilter) {
      case 'message':
        messages.forEach((msg) => push(msg, 'message'));
        break;
      case 'note':
        pushRanked(localNotes);
        serverNotes.forEach((note) => push(note, 'note'));
        break;
      case 'file':
        pushRanked(rankFiles());
        break;
      case 'workspace':
        pushRanked(rank(workspaceItems, 'workspace'));
        break;
      case 'repo':
        pushRanked(rank(repos, repoCategory));
        break;
      case 'agent':
        pushRanked(rank(agents, 'agent'));
        break;
      case 'change':
        pushRanked(rank(changes, 'change'));
        break;
      case 'terminal':
        pushRanked(rank(terminals, 'terminal'));
        break;
      case 'browser':
        pushRanked(rank(browserUrls, 'browser'));
        break;
    }
    return flat;
  }

  const instant = [
    ...rank(searchCommands, 'command'),
    ...rank(agents, 'agent'),
    ...localNotes,
    ...rank(changes, 'change'),
    ...rank(terminals, 'terminal'),
    ...rank(browserUrls, 'browser'),
    ...rank(workspaceItems, 'workspace'),
    ...rank(repos, repoCategory),
  ].sort(compareCandidates);
  placeNewWorkspaceBelowRepos(instant);

  const shownNotes = serverNotes.slice(0, MAX_BLENDED_SERVER_ROWS);
  const shownMessages = messages.slice(0, MAX_BLENDED_SERVER_ROWS);
  const serverRows =
    shownNotes.length +
    shownMessages.length +
    Number(serverNotes.length > MAX_BLENDED_SERVER_ROWS) +
    Number(messages.length > MAX_BLENDED_SERVER_ROWS);
  const fileCandidates = rankFiles();

  // Late results never take row 1 while an instant result matches.
  let local: Candidate[];
  if (instant.length > 0) {
    local = [instant[0], ...[...instant.slice(1), ...fileCandidates].sort(compareCandidates)];
  } else {
    local = fileCandidates;
  }
  local = local.slice(0, Math.max(instant.length > 0 ? 1 : 0, MAX_BLENDED_ROWS - serverRows));

  const pushServerNotes = () => {
    shownNotes.forEach((note) => push(note, 'note'));
    if (serverNotes.length > MAX_BLENDED_SERVER_ROWS) pushSeeAll('note');
  };
  const pushMessages = () => {
    shownMessages.forEach((msg) => push(msg, 'message'));
    if (messages.length > MAX_BLENDED_SERVER_ROWS) pushSeeAll('message');
  };
  const pushSeeAll = (filter: 'note' | 'message') =>
    flat.push({ _seeAll: true, _filter: filter, _key: `see-all:${filter}`, _idx: flat.length });

  if (instant.length > 0) {
    pushRanked(local);
    pushServerNotes();
    pushMessages();
    return flat;
  }

  // Nothing instant matched: the first late source to arrive leads.
  const sections: Record<PaletteLateSource, () => void> = {
    file: () => pushRanked(local),
    note: pushServerNotes,
    message: pushMessages,
  };
  const order = [...new Set<PaletteLateSource>([...lateArrivalOrder, 'file', 'note', 'message'])];
  order.forEach((source) => sections[source]());
  return flat;
}

/** "New Workspace" lists below matching repo rows unless its name is an exact match. */
function placeNewWorkspaceBelowRepos(ranked: Candidate[]): void {
  const from = ranked.findIndex((c) => c.category === 'command' && c.item.id === 'new-workspace');
  if (from === -1 || ranked[from].exact) return;
  let lastRepo = -1;
  ranked.forEach((c, i) => {
    if (c.category === 'repo' || c.category === 'folder') lastRepo = i;
  });
  if (lastRepo <= from) return;
  const [newWs] = ranked.splice(from, 1);
  ranked.splice(lastRepo, 0, newWs);
}

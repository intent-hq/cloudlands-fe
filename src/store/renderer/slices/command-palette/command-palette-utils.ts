/**
 * Pure utility functions for the CommandPalette.
 * Extracted from the component so they are testable outside Svelte.
 */

import { WorkspaceStatus, type Note } from '$shared/types';
import { formatRelativeTime as formatRelative, formatShortDate } from '$lib/i18n/format';
import type { PaletteMruEntry, PaletteObjectType } from '../palette/palette-types';

// ── Types ──────────────────────────────────────────────────────────────────

export type WorkspaceObjectType = PaletteObjectType;

export interface WorkspaceObject {
  id: string;
  type: WorkspaceObjectType;
  label: string;
  description?: string;
  icon: any;
  timestamp?: number;
  path?: string;
  url?: string;
  _time?: string;
  breadcrumbs?: string;
  /** Explicit note ownership; id may be an encoded MRU identity. */
  noteId?: string;
  workspaceId?: string;
}

export type MRUEntry = PaletteMruEntry;

/** All palette filter targets: workspace object types plus the palette-only
 * `workspace`, `message` (chat transcript) and `repo` (known repos) sections. */
export type PaletteFilter = WorkspaceObjectType | 'workspace' | 'message' | 'repo';

// ── Filter prefix mapping ──────────────────────────────────────────────────

export const FILTER_PREFIXES: Record<string, PaletteFilter> = {
  '@': 'agent',
  '#': 'note',
  '>': 'terminal',
  '~': 'change',
  '/': 'file',
  '*': 'workspace',
  '^': 'browser',
  '?': 'message',
  '+': 'repo',
};

// ── Pure functions ─────────────────────────────────────────────────────────

/** Build breadcrumbs string for a note by walking up the parent chain. */
export function buildNoteBreadcrumbs(note: Note, allNotes: Note[]): string {
  const noteMap = new Map(allNotes.map((n) => [n.id as string, n]));
  const breadcrumbs: string[] = [];
  let currentNote: Note | undefined = note;
  const visited = new Set<string>();

  while (currentNote?.parentId && !visited.has(currentNote.id as string)) {
    visited.add(currentNote.id as string);
    const parent = noteMap.get(currentNote.parentId as string);
    if (parent) {
      breadcrumbs.unshift(parent.title || 'Untitled');
      currentNote = parent;
    } else {
      break;
    }
  }

  return breadcrumbs.join(' / ');
}

/** Lightweight fuzzy scorer: returns -Infinity if not a subsequence match. */
export function fuzzyScore(haystackRaw: string, needleRaw: string): number {
  const haystack = (haystackRaw || '').toLowerCase();
  const needle = (needleRaw || '').toLowerCase();
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 200 + Math.max(0, 20 - needle.length);

  let best = -Infinity;
  for (
    let subIdx = haystack.indexOf(needle);
    subIdx !== -1;
    subIdx = haystack.indexOf(needle, subIdx + 1)
  ) {
    const prev = haystack[subIdx - 1];
    const atBoundary = prev === ' ' || prev === '/' || prev === '-' || prev === '_' || prev === '.';
    const occScore =
      (atBoundary ? 100 : 50) + Math.max(0, 20 - needle.length) + Math.max(0, 10 - subIdx);
    if (occScore > best) best = occScore;
  }
  if (best !== -Infinity) return best;

  let i = 0;
  let score = 0;
  let streak = 0;
  for (const ch of needle) {
    const idx = haystack.indexOf(ch, i);
    if (idx === -1) return -Infinity;
    const prev = idx > 0 ? haystack[idx - 1] : ' ';
    if (prev === ' ' || prev === '/' || prev === '-' || prev === '_' || prev === '.') score += 5;
    streak = idx === i ? streak + 1 : 1;
    score += streak * 2;
    score += Math.max(0, 3 - idx);
    i = idx + 1;
  }
  // Compress the walk into [0, 49) so a contiguous substring (>= 50) always outranks
  // any pure subsequence match; the transform is monotonic, preserving walk-internal order.
  return (49 * score) / (score + 49);
}

/** Weight applied to description/searchText matches so label matches rank higher. */
const SECONDARY_FIELD_WEIGHT = 0.5;

/**
 * Order-independent multi-word scorer over an item's fields. The query is
 * split on whitespace into deduplicated tokens; every token must fuzzy-match
 * at least one field (AND semantics) or the result is -Infinity. Each token
 * scores the label at full weight and description/searchText down-weighted,
 * taking the best; the item score is the sum of per-token scores.
 */
export function scoreItemFields(
  fields: { label: string; description?: string; searchText?: string },
  query: string,
): number {
  const tokens = [...new Set((query || '').trim().split(/\s+/).filter(Boolean))];
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    let tokenScore = fuzzyScore(fields.label, token);
    if (fields.description) {
      tokenScore = Math.max(
        tokenScore,
        SECONDARY_FIELD_WEIGHT * fuzzyScore(fields.description, token),
      );
    }
    if (fields.searchText) {
      tokenScore = Math.max(
        tokenScore,
        SECONDARY_FIELD_WEIGHT * fuzzyScore(fields.searchText, token),
      );
    }
    if (tokenScore === -Infinity) return -Infinity;
    total += tokenScore;
  }
  return total;
}

// ── Match tiers (blended ranking) ─────────────────────────────────────────

/**
 * Match strength of a query against an item, compared as a tier (never summed
 * with other signals). A secondary-field match ranks one tier below the same
 * match on a name; a loose match on a secondary field ranks lowest.
 */
export const MATCH_TIER = {
  none: 0,
  secondaryLoose: 0.5,
  loose: 1,
  substring: 2,
  wordStart: 3,
  startsWith: 4,
} as const;

const WORD_BOUNDARY = new Set([' ', '/', '-', '_', '.', ':', '~', '@', '#']);

/** Normalize a typed query for exact and pick-memory comparison. */
export function normalizeQuery(query: string): string {
  return (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isSubsequence(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of needle) {
    const idx = haystack.indexOf(ch, i);
    if (idx === -1) return false;
    i = idx + 1;
  }
  return true;
}

/** Tier of one lowercase needle against one field (name tiers). */
function fieldTier(fieldRaw: string | undefined, needle: string): number {
  if (!fieldRaw) return MATCH_TIER.none;
  const field = fieldRaw.toLowerCase();
  if (field.startsWith(needle)) return MATCH_TIER.startsWith;
  let idx = field.indexOf(needle);
  if (idx !== -1) {
    for (; idx !== -1; idx = field.indexOf(needle, idx + 1)) {
      if (WORD_BOUNDARY.has(field[idx - 1])) return MATCH_TIER.wordStart;
    }
    return MATCH_TIER.substring;
  }
  return isSubsequence(field, needle) ? MATCH_TIER.loose : MATCH_TIER.none;
}

function secondary(tier: number): number {
  if (tier === MATCH_TIER.none) return MATCH_TIER.none;
  return tier === MATCH_TIER.loose ? MATCH_TIER.secondaryLoose : tier - 1;
}

export interface MatchFields {
  /** Primary names: the label plus aliases (e.g. repo name, folder name). */
  names: string[];
  /** Secondary fields: description, path, searchText. */
  secondary: Array<string | undefined>;
}

function needleTier(fields: MatchFields, needle: string): number {
  let best: number = MATCH_TIER.none;
  for (const name of fields.names) {
    best = Math.max(best, fieldTier(name, needle));
    if (best === MATCH_TIER.startsWith) return best;
  }
  for (const field of fields.secondary) {
    best = Math.max(best, secondary(fieldTier(field, needle)));
  }
  return best;
}

/**
 * Match tier of a normalized query against an item. For a multi-word query
 * the tier is the weakest word's tier, unless the whole phrase matches better
 * (e.g. "new work" starts "New Workspace"). Returns 0 when any word misses.
 */
export function matchTier(fields: MatchFields, normalizedQuery: string): number {
  if (!normalizedQuery) return MATCH_TIER.none;
  const words = [...new Set(normalizedQuery.split(' '))];
  if (words.length === 1) return needleTier(fields, normalizedQuery);
  let weakest: number = MATCH_TIER.startsWith;
  for (const word of words) {
    weakest = Math.min(weakest, needleTier(fields, word));
    if (weakest === MATCH_TIER.none) return MATCH_TIER.none;
  }
  return Math.max(weakest, needleTier(fields, normalizedQuery));
}

/** True when any primary name equals the normalized query. */
export function isExactNameMatch(names: string[], normalizedQuery: string): boolean {
  return names.some((name) => (name || '').toLowerCase() === normalizedQuery);
}

/**
 * Format a date string as a compact relative time label in the active locale;
 * dates older than a week show a short date instead. Falsy inputs — including
 * the epoch-0 placeholder used for unattributed changes — format as "".
 */
export function formatRelativeTime(dateStr: Date | string | number | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const diffDays = (Date.now() - date.getTime()) / 86_400_000;
  if (diffDays >= 7) return formatShortDate(date);
  return formatRelative(date, { style: 'narrow' });
}

/** Parse a search query for filter prefix. */
export function parseQueryFilter(query: string): {
  filter: PaletteFilter | null;
  searchTerm: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return { filter: null, searchTerm: '' };

  const firstChar = trimmed[0];
  if (FILTER_PREFIXES[firstChar]) {
    return {
      filter: FILTER_PREFIXES[firstChar],
      searchTerm: trimmed.slice(1).trim(),
    };
  }

  return { filter: null, searchTerm: trimmed };
}

/**
 * Resolve the secondary title-line segments for a chat-message palette row:
 * the owning workspace's title, its "owner/repo" label, and whether the
 * workspace is archived. An unknown workspace yields no segments; a
 * repository without an owner yields just the repo name.
 */
export function buildMessageTitleSegments(
  workspace:
    | {
        id: string;
        title?: string;
        repositoryOwner?: string;
        repositoryName?: string;
        status?: WorkspaceStatus;
      }
    | undefined,
): { workspaceName?: string; repoLabel?: string; isArchivedWorkspace?: boolean } {
  if (!workspace) return {};
  return {
    workspaceName: workspace.title || workspace.id,
    repoLabel: workspace.repositoryName
      ? workspace.repositoryOwner
        ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
        : workspace.repositoryName
      : undefined,
    isArchivedWorkspace: workspace.status === WorkspaceStatus.Archived ? true : undefined,
  };
}

// ── MRU helpers ────────────────────────────────────────────────────────────

const MAX_RECENT_ITEMS = 3;

export function buildRecentItems(
  allObjects: WorkspaceObject[],
  mruEntries: MRUEntry[],
): WorkspaceObject[] {
  const seen = new Set<string>();
  return mruEntries
    .map(
      (entry) =>
        allObjects.find((obj) => obj.type === entry.type && obj.id === entry.id) ??
        // Legacy note IDs were bare. Callers supply current-workspace local notes,
        // so compatibility must never infer an owner from a global search result.
        (entry.type === 'note'
          ? allObjects.find((obj) => obj.type === 'note' && obj.noteId === entry.id)
          : undefined),
    )
    .filter((obj): obj is WorkspaceObject => obj !== undefined)
    .filter((obj) => {
      const key = JSON.stringify([obj.type, obj.id]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RECENT_ITEMS);
}

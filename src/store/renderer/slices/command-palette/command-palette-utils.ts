/**
 * Pure utility functions for the CommandPalette.
 * Extracted from the component so they are testable outside Svelte.
 */

import type { Note } from "$shared/types";
import { formatRelativeTime as formatRelative, formatShortDate } from "$lib/i18n/format";
import type { PaletteMruEntry, PaletteMruEntryType } from "../palette/palette-types";

// ── Types ──────────────────────────────────────────────────────────────────

export type WorkspaceObjectType = PaletteMruEntryType;

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
}

export type MRUEntry = PaletteMruEntry;

/** All palette filter targets: workspace object types plus the palette-only
 * `workspace` and `message` (chat transcript) sections. */
export type PaletteFilter = WorkspaceObjectType | "workspace" | "message";

// ── Filter prefix mapping ──────────────────────────────────────────────────

export const FILTER_PREFIXES: Record<string, PaletteFilter> = {
  "@": "agent",
  "#": "note",
  ">": "terminal",
  "~": "change",
  "/": "file",
  "*": "workspace",
  "^": "browser",
  "?": "message",
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
      breadcrumbs.unshift(parent.title || "Untitled");
      currentNote = parent;
    } else {
      break;
    }
  }

  return breadcrumbs.join(" / ");
}

/** Lightweight fuzzy scorer: returns -Infinity if not a subsequence match. */
export function fuzzyScore(haystackRaw: string, needleRaw: string): number {
  const haystack = (haystackRaw || "").toLowerCase();
  const needle = (needleRaw || "").toLowerCase();
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 200 + Math.max(0, 20 - needle.length);

  let i = 0;
  let score = 0;
  let streak = 0;
  for (const ch of needle) {
    const idx = haystack.indexOf(ch, i);
    if (idx === -1) return -Infinity;
    const prev = idx > 0 ? haystack[idx - 1] : " ";
    if (prev === " " || prev === "/" || prev === "-" || prev === "_" || prev === ".") score += 5;
    streak = idx === i ? streak + 1 : 1;
    score += streak * 2;
    score += Math.max(0, 3 - idx);
    i = idx + 1;
  }
  return score;
}

/**
 * Format a date string as a compact relative time label in the active locale;
 * dates older than a week show a short date instead.
 */
export function formatRelativeTime(dateStr: Date | string | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const diffDays = (Date.now() - date.getTime()) / 86_400_000;
  if (diffDays >= 7) return formatShortDate(date);
  return formatRelative(date, { style: "narrow" });
}

/** Parse a search query for filter prefix. */
export function parseQueryFilter(query: string): {
  filter: PaletteFilter | null;
  searchTerm: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return { filter: null, searchTerm: "" };

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
 * the owning workspace's title and its "owner/repo" label. An unknown
 * workspace yields no segments; a repository without an owner yields just the
 * repo name.
 */
export function buildMessageTitleSegments(
  workspace:
    | { id: string; title?: string; repositoryOwner?: string; repositoryName?: string }
    | undefined,
): { workspaceName?: string; repoLabel?: string } {
  if (!workspace) return {};
  return {
    workspaceName: workspace.title || workspace.id,
    repoLabel: workspace.repositoryName
      ? workspace.repositoryOwner
        ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
        : workspace.repositoryName
      : undefined,
  };
}

// ── MRU helpers ────────────────────────────────────────────────────────────

const MAX_RECENT_ITEMS = 3;

export function buildRecentItems(
  allObjects: WorkspaceObject[],
  mruEntries: MRUEntry[],
): WorkspaceObject[] {
  return mruEntries
    .map((entry) => allObjects.find((obj) => obj.type === entry.type && obj.id === entry.id))
    .filter((obj): obj is WorkspaceObject => obj !== undefined)
    .slice(0, MAX_RECENT_ITEMS);
}


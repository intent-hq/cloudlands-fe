/**
 * Pure utility functions for the CommandPalette.
 * Extracted from the component so they are testable outside Svelte.
 */

import type { Note } from "$shared/types";
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

// ── Filter prefix mapping ──────────────────────────────────────────────────

export const FILTER_PREFIXES: Record<string, WorkspaceObjectType | "workspace"> = {
  "@": "agent",
  "#": "note",
  ">": "terminal",
  "~": "change",
  "/": "file",
  "*": "workspace",
  "^": "browser",
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

/** Format a date string as a relative time label. */
export function formatRelativeTime(dateStr: Date | string | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Parse a search query for filter prefix. */
export function parseQueryFilter(query: string): {
  filter: WorkspaceObjectType | "workspace" | null;
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


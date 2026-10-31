/**
 * Read a rendered mention chip (`<span data-mention>`) back into what it
 * points at. The note editor, the chat composer and MarkdownViewer click and
 * hover handlers all read chips through this, so they agree on the
 * attribute fallbacks. The chips themselves are built by the mention
 * registry (registry.ts).
 */
import { parsePathSuffix } from './registry';

/** The minimal element surface the reader needs (no DOM globals). */
interface ChipElement {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
}

interface MentionChipNote {
  id: string;
  /** Set when the chip names a note in another workspace. */
  workspaceId?: string;
}

export interface MentionChip {
  type: string;
  id: string;
  label: string;
  uri: string;
  meta: Record<string, any>;
  /** For file chips: the workspace path to open, without `@` or a line suffix. */
  filePath?: string;
  /** For file chips: the line to reveal. */
  line?: number;
  /** For note chips: the note to open. */
  note?: MentionChipNote;
  /** An `intent://` link the chip was built from (`data-uri` or `meta.fullUrl`). */
  intentUrl?: string;
}

function readMeta(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const meta = JSON.parse(raw);
    return meta && typeof meta === 'object' ? meta : {};
  } catch {
    return {};
  }
}

function stripAt(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

function chipFilePath(meta: Record<string, any>, label: string, id: string, text: string) {
  const stored = meta.fullPath || meta.path || meta.filename;
  if (stored) return stripAt(String(stored));
  // Older chips may carry the path only in their id, label or visible text,
  // possibly with a line suffix; prefer whichever names a directory.
  const candidates = [id, label, text.trim()].map(stripAt).filter(Boolean);
  const fallback = candidates.find((value) => value.includes('/')) ?? candidates[0];
  return fallback ? parsePathSuffix(fallback).path : undefined;
}

function chipLine(meta: Record<string, any>): number | undefined {
  const line = meta.line ?? meta.startLine ?? meta.range?.start;
  return typeof line === 'number' && Number.isFinite(line) ? line : undefined;
}

/** Read a mention chip element; null when it is not one. */
export function readMentionChip(el: ChipElement | null | undefined): MentionChip | null {
  if (!el || el.getAttribute('data-mention') === null) return null;
  const type = el.getAttribute('data-type') || '';
  const id = el.getAttribute('data-id') || '';
  const label = el.getAttribute('data-label') || '';
  const uri = el.getAttribute('data-uri') || '';
  const meta = readMeta(el.getAttribute('data-meta'));
  const chip: MentionChip = { type, id, label, uri, meta };

  const intentUrl = uri.startsWith('intent://')
    ? uri
    : typeof meta.fullUrl === 'string' && meta.fullUrl.startsWith('intent://')
      ? meta.fullUrl
      : undefined;
  if (intentUrl) chip.intentUrl = intentUrl;

  if (type === 'file' || type === 'file-range') {
    const filePath = chipFilePath(meta, label, id, el.textContent || '');
    if (filePath) chip.filePath = filePath;
    const line = chipLine(meta);
    if (line !== undefined) chip.line = line;
  } else if (type === 'note' || type === 'note-range') {
    const noteId = meta.noteId || id;
    if (noteId) {
      chip.note =
        meta.isExternalLink && meta.workspaceId
          ? { id: noteId, workspaceId: String(meta.workspaceId) }
          : { id: noteId };
    }
  }
  return chip;
}

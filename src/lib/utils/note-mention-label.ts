/**
 * Display labels for mention chips, with live note titles.
 *
 * Note chips carry the title saved in their `@note[...]` token. Chat resolves
 * the note's current title from the store; the note editor, composer and
 * markdown viewer use these helpers to do the same at render time. Only the
 * displayed text changes — `data-label` and the saved token keep the original
 * title, so opening a note never silently rewrites its content.
 */

import { memberMentionLabel } from '$lib/utils/member-mention-token';

/** Current title of a note, or undefined when it is not in the local store. */
export type NoteTitleLookup = (workspaceId: string, noteId: string) => string | undefined;

interface MentionChipAttrs {
  type?: string | null;
  id?: string | null;
  label?: string | null;
  meta?: { workspaceId?: unknown; isExternalLink?: unknown } | null;
}

/** Workspace a note chip refers to: its own for sibling-workspace chips, else the current one. */
export function noteMentionWorkspace(
  meta: MentionChipAttrs['meta'],
  currentWorkspaceId: string | null | undefined,
): string | undefined {
  if (meta?.isExternalLink === true && typeof meta.workspaceId === 'string' && meta.workspaceId) {
    return meta.workspaceId;
  }
  return currentWorkspaceId || undefined;
}

/**
 * Text to show inside a mention chip. Note chips prefer the note's current
 * title and fall back to the saved label; member chips use their handle label.
 */
export function mentionChipDisplayLabel(
  attrs: MentionChipAttrs,
  currentWorkspaceId: string | null | undefined,
  lookup?: NoteTitleLookup,
): string {
  const label = attrs.label || attrs.id || 'mention';
  if (attrs.type === 'member') return memberMentionLabel(label);
  if (attrs.type === 'note' && attrs.id && lookup) {
    const workspaceId = noteMentionWorkspace(attrs.meta, currentWorkspaceId);
    const live = workspaceId ? lookup(workspaceId, attrs.id)?.trim() : undefined;
    if (live) return live;
  }
  return label;
}

/**
 * Relabel note chips in rendered HTML with live titles. Returns the input
 * string unchanged (same reference) when nothing changes, so a `$derived`
 * consumer does not re-render the DOM.
 */
export function relabelNoteChipsInHtml(
  html: string,
  currentWorkspaceId: string | null | undefined,
  lookup: NoteTitleLookup,
): string {
  if (typeof document === 'undefined' || !html.includes('data-type="note"')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  let changed = false;
  for (const el of template.content.querySelectorAll<HTMLElement>(
    '[data-mention][data-type="note"]',
  )) {
    let meta: MentionChipAttrs['meta'] = null;
    try {
      meta = JSON.parse(el.getAttribute('data-meta') || '{}');
    } catch {
      meta = null;
    }
    const current = el.textContent ?? '';
    const label = mentionChipDisplayLabel(
      { type: 'note', id: el.getAttribute('data-id'), label: current, meta },
      currentWorkspaceId,
      lookup,
    );
    if (label !== current) {
      el.textContent = label;
      changed = true;
    }
  }
  return changed ? template.innerHTML : html;
}

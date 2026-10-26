import type { PanelContextItem } from './multi-panel-context-slice';

/**
 * Note ids to send as a turn's `noteIds`: exactly the note and spec panels the
 * user has checked in the context picker, in order, without duplicates.
 * Returns `undefined` when none are checked so the field is omitted.
 *
 * The daemon references each note in the prompt (title, id and image links)
 * rather than inlining its content, so an unchecked note must not be sent.
 */
export function contextNoteIds(panels: readonly PanelContextItem[]): string[] | undefined {
  const ids = new Set<string>();
  for (const panel of panels) {
    if (!panel.checked || !panel.noteId) continue;
    if (panel.type !== 'note' && panel.type !== 'spec') continue;
    ids.add(panel.noteId);
  }
  return ids.size > 0 ? [...ids] : undefined;
}

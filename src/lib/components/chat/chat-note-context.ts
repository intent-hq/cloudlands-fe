import type { ContextReference } from '../../../features/agent/agent-context';
import type { ContextItem } from './input/context-item';

/** Source ChatPanel's note pointer. The provider reads text through its note tool;
 * `noteIds` on agent.sendMessage only resolves images embedded in those notes. */
export function formatNoteContext(noteId: string, label: string): string {
  const id = JSON.stringify(noteId);
  // i18n-ignore (agent-directed context marker, not user-facing UI)
  return `[Currently viewing note: ${JSON.stringify(label)} (ID: ${id.slice(1, -1)}). Use ws.note.read(${id}) to read its content.]`;
}

/** Prepare explicit composer references without reading/copying note bodies.
 * Callers check current note eligibility through the canonical notes owner.
 * Invalid references stay in the draft for removal; never send a valid subset. */
export function prepareNoteContext(
  workspaceId: string,
  items: readonly ContextItem[],
):
  | {
      ok: true;
      noteIds: string[];
      contextReferences: ContextReference[];
      workspaceContextStr: string;
    }
  | { ok: false; itemId: string; reason: 'invalid-reference' | 'cross-workspace' } {
  const noteIds: string[] = [];
  const contextReferences: ContextReference[] = [];
  const parts: string[] = [];
  for (const item of items) {
    if (item.type !== 'note') continue;
    if (
      typeof item.noteId !== 'string' ||
      !item.noteId.trim() ||
      item.noteId !== item.noteId.trim() ||
      typeof item.workspaceId !== 'string' ||
      !item.workspaceId.trim() ||
      item.workspaceId !== item.workspaceId.trim()
    ) {
      return { ok: false, itemId: item.id, reason: 'invalid-reference' };
    }
    if (item.workspaceId !== workspaceId)
      return { ok: false, itemId: item.id, reason: 'cross-workspace' };
    if (noteIds.includes(item.noteId)) continue;
    noteIds.push(item.noteId);
    contextReferences.push({ type: 'note', noteId: item.noteId, metadata: { workspaceId } });
    parts.push(formatNoteContext(item.noteId, item.label));
  }
  return { ok: true, noteIds, contextReferences, workspaceContextStr: parts.join('\n') };
}

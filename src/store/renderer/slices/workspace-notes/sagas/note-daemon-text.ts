/**
 * The exact note text the daemon served or acknowledged, per note and `rev`.
 *
 * The truncated-read write guard (§5.2 "Truncated note reads") needs the UTF-8
 * size of the base a whole-content write was built from, at the `rev` sent as
 * `expectedVersion`. Only daemon text qualifies: an editor baseline, a local
 * re-serialization or an unsent draft would claim a base the daemon never
 * stored and get the write refused. Rows are recorded from reads (`note.get`
 * results, full list rows) and save acknowledgements; the last few revs are
 * kept so a draft started on a slightly older rev still finds its base.
 */
import type { Note } from '$shared/types';

export interface DaemonText {
  rev: number;
  content: string;
  /** The daemon served only a prefix (`contentTruncated`): never a write base. */
  truncated: boolean;
}

const MAX_REVS_PER_NOTE = 3;
const texts = new Map<string, DaemonText[]>();

function key(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

export function recordDaemonText(workspaceId: string, noteId: string, text: DaemonText): void {
  const k = key(workspaceId, noteId);
  const kept = (texts.get(k) ?? []).filter((entry) => entry.rev !== text.rev);
  kept.push(text);
  kept.sort((a, b) => a.rev - b.rev);
  texts.set(k, kept.slice(-MAX_REVS_PER_NOTE));
}

/** Record a daemon-served note row; rows without a rev or a body are skipped. */
export function recordDaemonNote(workspaceId: string, note: Note): void {
  if (note.rev === undefined) return;
  if (!note.content && typeof note.contentLength === 'number' && note.contentLength > 0) return;
  recordDaemonText(workspaceId, String(note.id), {
    rev: note.rev,
    content: note.content ?? '',
    truncated: note.contentTruncated === true,
  });
}

export function daemonTextAt(
  workspaceId: string,
  noteId: string,
  rev: number | undefined,
): DaemonText | undefined {
  if (rev === undefined) return undefined;
  return texts.get(key(workspaceId, noteId))?.find((entry) => entry.rev === rev);
}

export function forgetWorkspaceDaemonTexts(workspaceId: string): void {
  for (const k of texts.keys()) if (k.startsWith(`${workspaceId}:`)) texts.delete(k);
}

export function clearDaemonTexts(): void {
  texts.clear();
}

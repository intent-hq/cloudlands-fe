import type { ContextItem } from '$features/context/types';
import type { Note } from '$shared/types';

export function normalizeSidebarSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

export function sidebarSearchMatches(query: string, values: unknown[]): boolean {
  const normalizedQuery = normalizeSidebarSearchText(query).trim();
  if (!normalizedQuery) return true;
  return values.some((value) => normalizeSidebarSearchText(value).includes(normalizedQuery));
}

export function filterContextNotes(notes: Note[], query: string): Note[] {
  const normalizedQuery = normalizeSidebarSearchText(query).trim();
  if (!normalizedQuery) return notes;

  const notesById = new Map(notes.map((note) => [String(note.id), note]));
  const visibleIds = new Set<string>();
  for (const note of notes) {
    // Slim note.list rows carry no content (§5.2) — match against the
    // contentPreview (first ~500 chars); a hit deep inside a very long note
    // may be missed (accepted degradation).
    const body = note.content || note.contentPreview;
    if (!sidebarSearchMatches(normalizedQuery, [note.title, body, note.id])) continue;
    let current: Note | undefined = note;
    const visited = new Set<string>();
    while (current && !visited.has(String(current.id))) {
      const id = String(current.id);
      visited.add(id);
      visibleIds.add(id);
      current = current.parentId ? notesById.get(String(current.parentId)) : undefined;
    }
  }
  return notes.filter((note) => visibleIds.has(String(note.id)));
}

function contextItemSearchValues(item: ContextItem): unknown[] {
  const values: unknown[] = [item.title, item.url, item.provider, item.type];
  if ('identifier' in item) values.push(item.identifier, item.teamKey, item.teamName, item.state);
  if ('number' in item) values.push(`#${item.number}`, item.number, item.repo, item.state);
  if ('shortId' in item) {
    values.push(item.shortId, item.project, item.projectName, item.level, item.status);
  }
  if ('noteId' in item) values.push(item.noteId);
  return values;
}

export function filterContextItems(items: ContextItem[], query: string): ContextItem[] {
  const normalizedQuery = normalizeSidebarSearchText(query).trim();
  if (!normalizedQuery) return items;
  return items.filter((item) =>
    sidebarSearchMatches(normalizedQuery, contextItemSearchValues(item)),
  );
}

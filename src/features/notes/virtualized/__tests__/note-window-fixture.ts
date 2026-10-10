import { NoteWindowView } from '../note-window-view';
import { readNoteWindow } from '../note-window-reader';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';

export function mountNoteWindowFixture(
  root: HTMLDivElement,
  scroller: HTMLDivElement,
  setStatus: (status: string) => void,
) {
  // External test fixture only. The production view/assembler never receive this backing string.
  const source = 'Paragraph café 世界 🌍 repeated text. '.repeat(100_000);
  const scope = {
    backendId: 'backend',
    workspaceId: 'workspace',
    noteId: 'note',
    noteInstanceId: 'instance',
  };
  const identity = {
    scope,
    sourceRevision: 'rev',
    snapshotId: 'snap',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const requests: NotePageRequest[] = [];
  let generation = 0;
  let maxOutstanding = 0;
  let outstanding = 0;
  let lastError = '';
  const fullOperations: string[] = [];
  const reader = new NotePageReader(async (method, params) => {
    if (method !== 'note.get') throw new Error('Unexpected method');
    const q = params.page as NotePageRequest;
    requests.push(q);
    outstanding++;
    maxOutstanding = Math.max(maxOutstanding, outstanding);
    try {
      if (q.kind === 'source') {
        let start = q.cursor ? Number(q.cursor) : (q.at ?? 0);
        if (/[\uDC00-\uDFFF]/.test(source[start])) start--;
        let end = Math.min(source.length, start + Math.min(1000, q.maxSourceBytes ?? 1000));
        while (
          new TextEncoder().encode(source.slice(start, end)).length > (q.maxSourceBytes ?? 16384)
        )
          end--;
        if (/[\uD800-\uDBFF]/.test(source[end - 1])) end--;
        return {
          ...identity,
          kind: 'noteSourcePage',
          sourceLength: source.length,
          range: { start, end },
          text: source.slice(start, end),
          nextCursor: end < source.length ? String(end) : null,
          previousCursor: start ? String(start) : null,
          contextRef: `context:${start}:${end}`,
          metadataRef: 'metadata',
        };
      }
      if (q.kind === 'context')
        return {
          ...identity,
          kind: 'noteContextPage',
          items: [
            {
              kind: 'boundary',
              id: 'p',
              sourceRange: { start: 0, end: source.length },
              construct: 'paragraph',
              continuationBefore: true,
              continuationAfter: true,
            },
          ],
          nextCursor: null,
        };
      throw new Error('No full or metadata reads allowed');
    } finally {
      outstanding--;
    }
  });
  const load = async (at: number) => {
    const gen = ++generation;
    try {
      const window = await readNoteWindow(
        (q) => reader.read('workspace', 'note', q),
        { at, ...identity },
        () => gen === generation,
      );
      if (gen === generation) {
        view.show(window);
        setStatus('ready');
      }
    } catch (error) {
      if (gen === generation) {
        lastError = String(error);
        setStatus('error');
      }
    }
  };
  const view = new NoteWindowView(scroller, {
    seek: (at) => void load(at),
    selectionChanged: () => {},
    fullOperation: (kind) => fullOperations.push(kind),
  });
  Object.assign(root, {
    view,
    load,
    read: () => ({
      cost: view.cost,
      range: view.window?.range,
      text: view.editor?.getText(),
      requests: requests.length,
      maxOutstanding,
      outstanding,
      lastError,
      fullOperations,
      sourceLength: source.length,
      mounted: scroller.querySelectorAll('.tiptap').length,
      pmNodes: view.cost.mountedNodes,
      sourceStarts: requests
        .filter((q) => q.kind === 'source')
        .map((q) => (q.kind === 'source' ? q.at : null)),
    }),
    geometry: (at: number) => {
      const pos = view.projection!.pmAt(at);
      const rect = view.editor!.view.coordsAtPos(pos);
      const viewport = scroller.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportTop: viewport.top,
        viewportBottom: viewport.bottom,
      };
    },
  });
  void load(0);
  return () => {
    generation++;
    view.destroy();
  };
}

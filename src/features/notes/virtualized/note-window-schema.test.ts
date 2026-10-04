import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { EditorView } from '@tiptap/pm/view';
import { store } from '$store/renderer/configured-store';
import type { Workspace } from '$shared/types';
vi.mock('./note-window-projection', async () => {
  const { SourceProjection } = await import('./projection/source-projection');
  return {
    projectNoteWindow: () => {
      const p = new SourceProjection('', 0, {
        canonical: true,
        revision: 0,
        from: 0,
        to: 0,
        before: [],
        after: [],
      });
      p.content.content = [
        {
          type: 'paragraph',
          content: [{ type: 'mention', attrs: { id: 'agent-a', label: 'Agent A', type: 'agent' } }],
        },
      ];
      return p;
    },
  };
});
import { NoteWindowView } from './note-window-view';
beforeAll(() => {
  store.init();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(null);
});
afterAll(() => {
  store.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('retains workspace mentions in the production disposable native view', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const view = new NoteWindowView(host, {
    workspace: { id: 'ws-a' } as Workspace,
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  try {
    view.show({
      scope: { backendId: 'b', workspaceId: 'ws-a', noteId: 'n', noteInstanceId: 'i' },
      sourceRevision: 'r',
      snapshotId: 's',
      sourceLength: 0,
      range: { start: 0, end: 0 },
      text: '',
      context: [],
      mapBindings: [],
      details: {},
      documentEnd: true,
      cost: { sourceBytes: 0, contextBytes: 0, requests: 0, wireBytes: 0, assemblyPeakBytes: 0 },
    });
    const mention = view.editor?.state.doc.firstChild?.firstChild;
    expect(mention?.type.name).toBe('mention');
    expect(mention?.attrs.id).toBe('agent-a');
    expect(view.host.querySelector('[data-mention="true"]')).not.toBeNull();
  } finally {
    view.destroy();
    host.remove();
  }
});

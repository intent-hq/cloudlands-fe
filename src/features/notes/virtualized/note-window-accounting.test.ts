import { expect, it, vi } from 'vitest';
import { EditorView } from '@tiptap/pm/view';
vi.mock('$lib/utils/editor-config', async () => {
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  return { createEditorConfig: (options: object) => ({ ...options, extensions: [StarterKit] }) };
});
import { NoteWindowView } from './note-window-view';
import type { NoteWindow } from './note-window-reader';
const windowAt = (start: number): NoteWindow => ({
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'r',
  snapshotId: 's',
  sourceLength: 3_000_000,
  range: { start, end: start + 200 },
  text: 'x'.repeat(200),
  context: [],
  mapBindings: [],
  details: {},
  documentEnd: false,
  cost: { sourceBytes: 200, contextBytes: 0, requests: 2, wireBytes: 500, assemblyPeakBytes: 900 },
});
it('accounts for replacement overlap and only the latest force-mounted pending window', () => {
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const view = new NoteWindowView(document.createElement('div'), {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  try {
    view.show(windowAt(0));
    const first = view.cost.derivedBytes;
    view.show(windowAt(500_000));
    expect(view.cost.projectionPeakBytes).toBeGreaterThanOrEqual(first + view.cost.derivedBytes);
    expect(view.cost.windowAssemblyPeakBytes).toBe(900);
    expect(view.cost.mountedViews).toBe(1);
    const release = view.forceMount('selection');
    view.show(windowAt(1_000_000));
    view.show(windowAt(2_000_000));
    expect(view.cost.pendingBytes).toBe(200);
    expect(view.cost.mountedViews).toBe(1);
    release();
    expect(view.window?.range.start).toBe(2_000_000);
    expect(view.cost.pendingBytes).toBe(0);
    expect(view.cost.createdViews - view.cost.destroyedViews).toBe(1);
    view.destroy();
    expect(view.cost.mountedNodes).toBe(0);
    expect(view.cost.derivedBytes).toBe(0);
  } finally {
    view.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

it('accounts for asynchronous native DOM output beyond the ProseMirror tree and releases it', async () => {
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const view = new NoteWindowView(document.createElement('div'), {
    seek: vi.fn(),
    selectionChanged: vi.fn(),
    fullOperation: vi.fn(),
  });
  try {
    view.show(windowAt(0));
    const initial = { ...view.cost };
    const output = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    output.setAttribute('aria-label', 'café 🌍');
    text.textContent = 'λ'.repeat(4096);
    output.append(text);
    view.host.append(output);
    await vi.waitFor(() =>
      expect(view.cost.domPayloadBytes).toBeGreaterThan(initial.domPayloadBytes + 8192),
    );
    expect(view.cost.mountedNodes).toBe(initial.mountedNodes);
    expect(view.cost.mountedDomNodes).toBe(initial.mountedDomNodes + 3);
    expect(view.cost.domPeakBytes).toBe(view.cost.domPayloadBytes);
    output.remove();
    await vi.waitFor(() => expect(view.cost.domPayloadBytes).toBe(initial.domPayloadBytes));
    expect(view.cost.domPeakBytes).toBeGreaterThan(view.cost.domPayloadBytes);
    view.destroy();
    expect(view.cost.domPayloadBytes).toBe(0);
    expect(view.cost.mountedDomNodes).toBe(0);
  } finally {
    view.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

import { afterEach, expect, it, vi } from 'vitest';
import { EditorView } from '@tiptap/pm/view';
import { EditorState, TextSelection } from '@tiptap/pm/state';
vi.mock('$lib/utils/editor-config', async () => {
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  return { createEditorConfig: (options: object) => ({ ...options, extensions: [StarterKit] }) };
});
import { NoteWindowView } from './note-window-view';
import type { NoteWindow } from './note-window-reader';
const views: NoteWindowView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function tinyWindow(start = 0): NoteWindow {
  return {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r:1',
    snapshotId: 's',
    sourceLength: 83,
    range: { start, end: Math.min(83, start + 16) },
    text: 'x'.repeat(Math.min(16, 83 - start)),
    context: [],
    mapBindings: [],
    details: {},
    documentEnd: start + 16 >= 83,
    cost: { sourceBytes: 16, contextBytes: 0, requests: 1, wireBytes: 200, assemblyPeakBytes: 300 },
  };
}
function mount() {
  let resize = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(null);
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({
    top: 0,
    bottom: 16,
    left: 0,
    right: 8,
  });
  const scroller = document.createElement('div');
  document.body.append(scroller);
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400));
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const seek = vi.fn();
  const grow = vi.fn();
  const selectionChanged = vi.fn();
  const view = new NoteWindowView(scroller, {
    seek,
    grow,
    selectionChanged,
    fullOperation: vi.fn(),
  });
  views.push(view);
  vi.spyOn(view.host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 32));
  view.show(tinyWindow());
  return {
    view,
    seek,
    grow,
    selectionChanged,
    frames: () => {
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(0));
    },
    resize: () => resize(),
    scroll: () => scroller.dispatchEvent(new Event('scroll')),
  };
}
it('advances a tiny admitted window instead of requesting its current start again', () => {
  const { view, seek, scroll } = mount();
  scroll();
  expect(seek).toHaveBeenCalled();
  const first = seek.mock.lastCall![0];
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(16);
  scroll();
  expect(seek).toHaveBeenCalledTimes(1);
  view.show(tinyWindow(first));
  scroll();
  expect(seek.mock.lastCall![0]).toBeGreaterThan(first);
});
it('grows at the same anchor without hiding prefix or reissuing exhausted demand', () => {
  const { view, seek, grow, resize, frames } = mount();
  resize();
  frames();
  expect(grow).toHaveBeenCalledTimes(1);
  expect(grow.mock.lastCall![0]).toBe(view.window);
  expect(grow.mock.lastCall![1]).toBe(32);
  expect(seek).not.toHaveBeenCalled();
  expect(view.editor!.getText()).toBe('x'.repeat(16));
  resize();
  frames();
  expect(grow).toHaveBeenCalledTimes(1);
  // Rejected/unchanged growth leaves the exact same mounted prefix. Resizing
  // after settlement cannot turn the failed attempt into an automatic loop.
  view.updateReadStatus(true, false, false);
  resize();
  frames();
  expect(grow).toHaveBeenCalledTimes(1);
  expect(view.editor!.getText()).toBe('x'.repeat(16));
  view.setSelection({ anchor: 2, head: 5, anchorAffinity: 1, headAffinity: 1 });
  view.show({ ...tinyWindow(), range: { start: 0, end: 32 }, text: 'x'.repeat(32) });
  expect(view.getSelection()).toEqual({ anchor: 2, head: 5, anchorAffinity: 1, headAffinity: 1 });
  expect(view.editor!.getText()).toBe('x'.repeat(32));
  frames();
  expect(grow.mock.lastCall![1]).toBe(64);
});
it('pages through third and fourth parts and back without any scroll events', () => {
  const { view, seek } = mount();
  for (const start of [16, 32, 48]) {
    view.updateReadStatus(true, false, false);
    view.page(1);
    expect(seek.mock.lastCall![0]).toBe(start);
    view.show(tinyWindow(start));
  }
  view.updateReadStatus(true, false, false);
  view.page(-1);
  expect(seek.mock.lastCall![0]).toBe(32);
  view.show(tinyWindow(32));
  view.updateReadStatus(true, false, false);
  view.page(-1);
  expect(seek.mock.lastCall![0]).toBe(16);
});
it('cancels queued growth on unavailability, explicit paging and destruction', () => {
  const { view, grow, resize, frames, seek } = mount();
  resize();
  view.updateReadStatus(false, false, false);
  frames();
  expect(grow).not.toHaveBeenCalled();
  view.updateReadStatus(true, false, false);
  view.page(1);
  frames();
  expect(grow).not.toHaveBeenCalled();
  expect(seek).toHaveBeenCalledWith(16);
  view.updateReadStatus(true, false, false);
  resize();
  view.destroy();
  frames();
  expect(grow).not.toHaveBeenCalled();
});
it('does not demand past the document end or after destruction', () => {
  const { view, seek, resize, scroll } = mount();
  view.show({
    ...tinyWindow(),
    range: { start: 0, end: 83 },
    text: 'x'.repeat(83),
    documentEnd: true,
  });
  seek.mockClear();
  resize();
  scroll();
  expect(seek).not.toHaveBeenCalled();
  view.destroy();
  scroll();
  expect(seek).not.toHaveBeenCalled();
});

it('ignored automatic growth leaves explicit paging responsive without resize retries', () => {
  const { view, grow, seek, frames, resize } = mount();
  grow.mockReturnValue(false);
  frames();
  expect(grow).toHaveBeenCalledTimes(1);
  resize();
  frames();
  expect(grow).toHaveBeenCalledTimes(1);
  view.page(1);
  expect(seek).toHaveBeenLastCalledWith(16);
});

it('bounds previous anchors and falls back to source zero after older anchors are evicted', () => {
  const { view, seek } = mount();
  const part = (start: number): NoteWindow => ({
    ...tinyWindow(),
    sourceLength: 1024,
    range: { start, end: start + 16 },
    text: '🙂'.repeat(8),
    documentEnd: false,
  });
  for (let start = 0; start <= 320; start += 16) {
    view.show(part(start));
    view.updateReadStatus(true, false, false);
    view.page(1);
    expect(seek).toHaveBeenLastCalledWith(start + 16);
  }
  let start = 336;
  for (let expected = 320; expected >= 80; expected -= 16) {
    view.show(part(start));
    view.updateReadStatus(true, false, false);
    view.page(-1);
    expect(seek).toHaveBeenLastCalledWith(expected);
    start = expected;
  }
  view.show(part(80));
  view.updateReadStatus(true, false, false);
  view.page(-1);
  expect(seek).toHaveBeenLastCalledWith(0);
});
it('offers a scalar-safe start fallback after a far seek without paging history', () => {
  const { view, seek } = mount();
  view.show({
    ...tinyWindow(),
    sourceLength: 4096,
    range: { start: 2048, end: 2064 },
    text: '🙂'.repeat(8),
    documentEnd: false,
  });
  view.updateReadStatus(true, false, false);
  view.page(-1);
  expect(seek).toHaveBeenLastCalledWith(0);
});

const findRange = (anchor: number, head: number) => ({
  anchor,
  head,
  anchorAffinity: 1 as const,
  headAffinity: -1 as const,
});
it('publishes explicit Find selection without making generic selection steal focus', () => {
  const { view, seek } = mount();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  view.setSelection(findRange(2, 5));
  expect(document.activeElement).toBe(input);
  view.selectFindHit(findRange(5, 2), () => true);
  expect(document.getSelection()?.toString()).toBe('xxx');
  expect(view.getSelection()).toEqual(findRange(5, 2));
  expect(document.activeElement).toBe(view.host.querySelector('.ProseMirror'));
  expect(seek).not.toHaveBeenCalled();
});
it('publishes a far Find hit once on its matching admitted window', () => {
  const { view, seek } = mount();
  view.selectFindHit(findRange(18, 21), () => true);
  expect(seek).toHaveBeenCalledExactlyOnceWith(18);
  view.show(tinyWindow(18));
  expect(document.getSelection()?.toString()).toBe('xxx');
  expect(view.getSelection()).toEqual(findRange(18, 21));
  expect(seek).toHaveBeenCalledTimes(1);
});
for (const reason of ['query', 'close', 'navigation', 'revision', 'composition'] as const) {
  it(`does not publish a pending Find hit after ${reason}`, () => {
    const { view } = mount();
    let current = true;
    view.selectFindHit(findRange(18, 21), () => current);
    if (reason === 'query') current = false;
    if (reason === 'close') view.cancelFindSelection();
    if (reason === 'navigation') view.scroller.dispatchEvent(new Event('pointerdown'));
    if (reason === 'composition') view.host.dispatchEvent(new Event('compositionstart'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const next = tinyWindow(18);
    if (reason === 'revision') next.sourceRevision = 'r:2';
    view.show(next);
    expect(document.activeElement).toBe(input);
    expect(document.getSelection()?.toString() ?? '').toBe('');
  });
}
it('does not publish a partial Find hit as an exact selection', () => {
  const { view, seek } = mount();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  view.selectFindHit(findRange(18, 70), () => true);
  view.show(tinyWindow(18));
  expect(document.activeElement).toBe(input);
  expect(document.getSelection()?.toString() ?? '').toBe('');
  expect(seek).toHaveBeenCalledExactlyOnceWith(18);
});
for (const callback of ['focus', 'domAtPos'] as const) {
  it(`refuses Find DOM publication when ${callback} destroys its native owner`, () => {
    const { view } = mount();
    const dom = view.host.querySelector<HTMLElement>('.ProseMirror')!;
    if (callback === 'focus') vi.spyOn(dom, 'focus').mockImplementation(() => view.destroy());
    else
      vi.spyOn(EditorView.prototype, 'domAtPos').mockImplementation(() => {
        view.destroy();
        return { node: dom, offset: 0 };
      });
    view.selectFindHit(findRange(2, 5), () => true);
    expect(document.getSelection()?.toString() ?? '').toBe('');
    expect(view.host.querySelector('.ProseMirror')).toBeNull();
  });
}

for (const [anchor, head] of [
  [15, 21],
  [21, 15],
]) {
  it(`loads both Find endpoints for ${anchor} to ${head} across the current start`, () => {
    const { view, seek } = mount();
    view.show(tinyWindow(18));
    view.selectFindHit(findRange(anchor, head), () => true);
    expect(seek).toHaveBeenCalledExactlyOnceWith(15);
    view.show(tinyWindow(15));
    expect(document.getSelection()?.toString()).toBe('xxxxxx');
    expect(view.getSelection()).toEqual(findRange(anchor, head));
    expect(seek).toHaveBeenCalledTimes(1);
  });
}
for (const callback of ['current', 'selectionChanged', 'focus'] as const) {
  it(`preserves the newer Find intent installed during ${callback}`, () => {
    const { view, seek, selectionChanged } = mount();
    let replaced = false;
    const replace = () => {
      if (!replaced) {
        replaced = true;
        view.selectFindHit(findRange(18, 21), () => true);
      }
    };
    if (callback === 'selectionChanged') selectionChanged.mockImplementationOnce(replace);
    if (callback === 'focus')
      vi.spyOn(
        view.host.querySelector<HTMLElement>('.ProseMirror')!,
        'focus',
      ).mockImplementationOnce(replace);
    view.selectFindHit(findRange(2, 5), () => {
      if (callback === 'current') replace();
      return true;
    });
    expect(seek).toHaveBeenCalledExactlyOnceWith(18);
    view.show(tinyWindow(18));
    expect(document.getSelection()?.toString()).toBe('xxx');
    expect(view.getSelection()).toEqual(findRange(18, 21));
  });
}
it('does not reinstall Find after cancellation inside its current predicate', () => {
  const { view, seek } = mount();
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  view.selectFindHit(findRange(18, 21), () => {
    view.cancelFindSelection();
    return true;
  });
  view.show(tinyWindow(18));
  expect(document.activeElement).toBe(input);
  expect(seek).not.toHaveBeenCalled();
});
it('does not publish into a replacement editor installed during focus', () => {
  const { view } = mount();
  const dom = view.host.querySelector<HTMLElement>('.ProseMirror')!;
  vi.spyOn(dom, 'focus').mockImplementationOnce(() =>
    view.show({ ...tinyWindow(), sourceRevision: 'r:2' }),
  );
  view.selectFindHit(findRange(2, 5), () => true);
  expect(document.getSelection()?.toString() ?? '').toBe('');
  expect(view.host.querySelector('.ProseMirror')).not.toBe(dom);
});

for (const changed of ['document', 'selection'] as const) {
  it(`rejects same-editor ${changed} replacement during Find focus`, () => {
    const { view } = mount();
    const dom = view.host.querySelector<HTMLElement>('.ProseMirror')!;
    const native = (dom as HTMLElement & { editor: { view: EditorView } }).editor.view;
    const resolve = vi.spyOn(native, 'domAtPos');
    vi.spyOn(dom, 'focus').mockImplementationOnce(() => {
      const state = native.state;
      if (changed === 'document') {
        // Read-only transaction filters reject insertText; replace native state
        // directly to exercise an actual same-editor document replacement.
        const doc = state.schema.node('doc', null, [
          state.schema.node('paragraph', null, state.schema.text('changed document text')),
        ]);
        native.updateState(
          EditorState.create({
            schema: state.schema,
            doc,
            plugins: state.plugins,
            selection: TextSelection.create(doc, state.selection.anchor, state.selection.head),
          }),
        );
        expect(native.state.doc).not.toBe(state.doc);
      } else {
        native.updateState(
          state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 2))),
        );
        expect(native.state.selection.toJSON()).toEqual({ type: 'text', anchor: 1, head: 2 });
      }
    });
    view.selectFindHit(findRange(2, 5), () => true);
    expect(resolve).not.toHaveBeenCalled();
    expect(document.getSelection()?.toString() ?? '').toBe('');
    expect(view.host.querySelector('.ProseMirror')).toBe(dom);
  });
}

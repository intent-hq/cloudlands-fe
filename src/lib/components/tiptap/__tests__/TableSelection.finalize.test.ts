import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, tableEditingKey } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { createEditorConfig } from '$lib/utils/editor-config';
import { store } from '$store/renderer/configured-store';

beforeAll(() => store.init());
afterAll(() => store.dispose());

// Browser tests exercise real drag/DOM observation. These controls isolate the
// owning native callback's cancellation and current-state guards.
for (const scenario of [
  'active',
  'deferred',
  'text',
  'blurred',
  'canceled',
  'secondary',
  'ownership-cleared',
  'destroyed',
  'destroyed-during-observation',
  'reentrant-release',
  'newer-during-observation',
  'observation-error',
] as const) {
  it(`finalizes native cell drag with ${scenario}`, () => {
    const element = document.createElement('div');
    document.body.append(element);
    const editor = new Editor(
      createEditorConfig({
        element,
        content:
          '<p>before</p><table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table><p>after</p>',
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    const view = editor.view as typeof editor.view & {
      domObserver: { flushingSoon: number; flush: () => void; forceFlush: () => void };
    };
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.spec.tableRole === 'cell') cells.push(pos);
    });
    view.dispatch(
      view.state.tr
        .setSelection(CellSelection.create(view.state.doc, cells[0], cells[1]))
        .setMeta(tableEditingKey, cells[0]),
    );
    const before = view.state.doc.toJSON();
    const selection = view.state.selection.toJSON();
    const plugin = view.state.plugins.find((candidate) => candidate.spec.key === tableEditingKey)!;
    const listeners: Array<{ type: string; listener: EventListener }> = [];
    const root = view.root;
    const add = root.addEventListener;
    const registration = vi
      .spyOn(root, 'addEventListener')
      .mockImplementation(function (type, listener, options) {
        if (typeof listener === 'function') listeners.push({ type, listener });
        return Reflect.apply(add, root, [type, listener, options]);
      });
    const event = new MouseEvent('mousedown', { button: 0 });
    Object.defineProperty(event, 'target', { value: element.querySelector('td') });
    plugin.props.handleDOMEvents!.mousedown!(view, event);
    registration.mockRestore();
    const stop = listeners.find(({ type }) => type === 'mouseup')!.listener;
    expect(listeners.find(({ type }) => type === 'dragstart')!.listener).toBe(stop);
    const focus = vi.spyOn(view, 'hasFocus').mockReturnValue(scenario !== 'blurred');
    const flush = vi.spyOn(view.domObserver, 'flush').mockImplementation(() => {
      if (scenario === 'newer-during-observation')
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
      if (scenario === 'destroyed-during-observation') editor.destroy();
      if (scenario === 'reentrant-release')
        root.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      if (scenario === 'observation-error') throw new Error('diagnostic observation failure');
    });
    const force = vi.spyOn(view.domObserver, 'forceFlush').mockImplementation(() => {
      view.domObserver.flushingSoon = -1;
      flush();
    });
    if (scenario === 'deferred') view.domObserver.flushingSoon = 123;
    if (scenario === 'text')
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    if (scenario === 'ownership-cleared') view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
    if (scenario === 'destroyed') editor.destroy();
    try {
      const release = new MouseEvent(scenario === 'canceled' ? 'dragstart' : 'mouseup', {
        button: scenario === 'secondary' ? 2 : 0,
      });
      if (scenario === 'observation-error')
        expect(() => stop.call(root, release)).toThrow('diagnostic observation failure');
      else stop.call(root, release);
      const observed = [
        'destroyed-during-observation',
        'reentrant-release',
        'active',
        'deferred',
        'newer-during-observation',
        'observation-error',
      ].includes(scenario);
      expect(flush).toHaveBeenCalledTimes(observed ? 1 : 0);
      expect(force).toHaveBeenCalledTimes(scenario === 'deferred' ? 1 : 0);
      expect(view.state.doc.toJSON()).toEqual(before);
      if (!editor.isDestroyed) {
        expect(tableEditingKey.getState(view.state)).toBeNull();
        expect(view.state.selection.toJSON()).toEqual(
          scenario === 'text' || scenario === 'newer-during-observation'
            ? { type: 'text', anchor: 1, head: 1 }
            : selection,
        );
      }
    } finally {
      view.domObserver.flushingSoon = -1;
      force.mockRestore();
      flush.mockRestore();
      focus.mockRestore();
      if (!editor.isDestroyed) editor.destroy();
      element.remove();
    }
  });
}

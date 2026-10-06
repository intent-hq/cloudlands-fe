// @verify-changed-triggers: package.json, pnpm-lock.yaml, patches/@tiptap__core@3.31.3.patch
/** Named scheduling ownership only; fake clocks/jsdom do not prove native focus or remount authority. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin } from '@tiptap/pm/state';
import { createEditorDeferredTasks } from './editor-deferred-tasks';

const require = createRequire(import.meta.url);
const cjs = require('@tiptap/core') as typeof import('@tiptap/core');
const cjsStarter = require('@tiptap/starter-kit') as typeof import('@tiptap/starter-kit');
const editors: Editor[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const editor of editors.splice(0)) {
    try {
      editor.destroy();
    } catch {
      /* Intentional failed lifetime remains refused. */
    }
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function fixture(owned = true, module = { Editor, StarterKit }, extra = {}) {
  const owner = createEditorDeferredTasks();
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new module.Editor({
    element,
    extensions: [module.StarterKit],
    content: '<p>ab</p>',
    ...(owned ? { deferredTasks: owner.port } : {}),
    ...extra,
  });
  editors.push(editor);
  return { editor, owner, scope: owned ? editor.captureDeferredTasks(editor.view)! : undefined };
}
for (const [name, module] of [
  ['esm', { Editor, StarterKit }],
  ['cjs', { Editor: cjs.Editor, StarterKit: cjsStarter.StarterKit }],
] as const) {
  describe(name, () => {
    it('preserves default deferred create and ordinary options changes', async () => {
      const onCreate = vi.fn();
      const { editor } = fixture(false, module, { onCreate });
      expect(onCreate).not.toHaveBeenCalled();
      expect(editor.captureDeferredTasks(editor.view)).toBeUndefined();
      editor.setOptions({ editable: false });
      await vi.runAllTimersAsync();
      expect(onCreate).toHaveBeenCalledOnce();
      expect(editor.isInitialized).toBe(true);
    });
    it('owns the actual mount callback and cancels it before unmount', async () => {
      const onCreate = vi.fn();
      const { editor, scope } = fixture(true, module, { onCreate });
      editor.unmount();
      await scope!.settled;
      await vi.runAllTimersAsync();
      expect(onCreate).not.toHaveBeenCalled();
      expect(editor.isInitialized).toBe(false);
    });
    it('drains actual nested autofocus and core focus frames', async () => {
      const scroll = vi.fn(() => true);
      const { editor, scope } = fixture(true, module, {
        autofocus: 'end',
        editorProps: { handleScrollToSelection: scroll },
      });
      const focus = vi.spyOn(editor.view, 'focus');
      await vi.runAllTimersAsync();
      await scope!.whenIdle();
      expect(focus).toHaveBeenCalled();
      expect(editor.state.selection.from).toBe(3);
      expect(scroll).toHaveBeenCalled();
      expect(editor.isInitialized).toBe(true);
    });
    it('checks cancellation after hasFocus before selection effects', () => {
      const { editor, scope } = fixture(true, module);
      const before = editor.state.selection;
      vi.spyOn(editor.view, 'hasFocus').mockImplementation(() => {
        scope!.close();
        return false;
      });
      expect(() => editor.commands.focus('end')).toThrow();
      expect(editor.state.selection.eq(before)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
}

it('refuses immutable port replacement, removal and ordinary retrofit', () => {
  const { editor } = fixture();
  expect(() => editor.setOptions({ deferredTasks: createEditorDeferredTasks().port })).toThrow();
  expect(() => editor.setOptions({ deferredTasks: undefined })).toThrow();
  const plain = fixture(false).editor;
  expect(() => plain.setOptions({ deferredTasks: createEditorDeferredTasks().port })).toThrow();
});
it('rejects a replaced options accessor without invoking it', () => {
  const { editor } = fixture();
  const getter = vi.fn();
  Object.defineProperty(editor.options, 'deferredTasks', { get: getter });
  expect(() => editor.captureDeferredTasks(editor.view)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
it('rejects exact foreign view and repeated binding', () => {
  const a = fixture();
  const b = fixture();
  expect(() => a.owner.port.capture(a.editor, b.editor.view)).toThrow();
  expect(() => a.owner.port.bindView(a.scope!, a.editor, a.editor.view)).toThrow();
});
it('refuses view-dependent capture during actual plugin construction', () => {
  const owner = createEditorDeferredTasks();
  const calls: boolean[] = [];
  const probe = Extension.create({
    name: 'prebindingProbe',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          view(view) {
            try {
              owner.port.capture(editor, view);
              calls.push(false);
            } catch {
              calls.push(true);
            }
            return {};
          },
        }),
      ];
    },
  });
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, probe],
    content: '<p>ab</p>',
    deferredTasks: owner.port,
  });
  editors.push(editor);
  expect(calls).toEqual([true]);
  expect(editor.captureDeferredTasks(editor.view)).toBeDefined();
});
it('keeps closed settlement distinct from revocable open idleness', async () => {
  const { scope } = fixture();
  await vi.runAllTimersAsync();
  await scope!.whenIdle();
  let drained = false;
  void scope!.settled.then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  const body = vi.fn();
  scope!.enqueue('selection-focus', body);
  expect(body).not.toHaveBeenCalled();
  scope!.close();
  await scope!.settled;
  expect(drained).toBe(true);
  expect(body).not.toHaveBeenCalled();
});
it('keeps old nested callbacks closed and blocks reentrant mount until unwind', async () => {
  const { editor, scope } = fixture();
  scope!.enqueue('selection-focus', () => {
    scope!.close();
    expect(() => editor.mount(document.createElement('div'))).toThrow();
    expect(() => scope!.enqueue('focus-frame', () => {})).toThrow();
  });
  await vi.runAllTimersAsync();
  await expect(scope!.settled).rejects.toThrow();
});
it('holds the slot throughout synchronous unmount callbacks', async () => {
  const { editor, scope } = fixture();
  let refused = false;
  editor.on('unmount', () => {
    try {
      editor.mount(document.createElement('div'));
    } catch {
      refused = true;
    }
  });
  editor.unmount();
  await scope!.settled;
  expect(refused).toBe(true);
});
it('bounds task admission before creating another browser handle', () => {
  const { scope } = fixture();
  for (let i = 0; i < 31; i++) scope!.enqueue('selection-focus', () => {});
  expect(vi.getTimerCount()).toBe(32);
  expect(() => scope!.enqueue('selection-focus', () => {})).toThrow(/limit/);
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds nested synchronous frames and rejects thenables', async () => {
  const { scope } = fixture();
  const nest = (n: number): void =>
    scope!.run(() => {
      if (n) nest(n - 1);
    });
  expect(() => nest(8)).toThrow(/limit/);
  await expect(scope!.settled).rejects.toThrow();
  const next = fixture();
  expect(() => next.scope!.run(() => Promise.resolve())).toThrow(/synchronous/);
  await expect(next.scope!.settled).rejects.toThrow(/synchronous/);
});
it('records thrown callbacks and refuses reuse', async () => {
  const { owner, editor, scope } = fixture();
  scope!.enqueue('selection-focus', () => {
    throw new Error('callback failed');
  });
  await vi.runAllTimersAsync();
  await expect(scope!.settled).rejects.toThrow('callback failed');
  expect(() => owner.port.beginMount(editor)).toThrow();
});
it('cancels the returned handle when registration reentrantly retires', () => {
  const real = window.setTimeout.bind(window);
  let retire: (() => void) | undefined;
  vi.spyOn(window, 'setTimeout').mockImplementation(((body: TimerHandler, ms?: number) => {
    const handle = real(body, ms);
    retire?.();
    return handle;
  }) as typeof window.setTimeout);
  const { owner, scope } = fixture();
  retire = owner.retire;
  const body = vi.fn();
  expect(() => scope!.enqueue('selection-focus', body)).toThrow();
  expect(vi.getTimerCount()).toBe(0);
  expect(body).not.toHaveBeenCalled();
});
it('rejects synchronous scheduler invocation before exposing its body', () => {
  const real = window.setTimeout.bind(window);
  let synchronous = false;
  vi.spyOn(window, 'setTimeout').mockImplementation(((body: TimerHandler, ms?: number) => {
    if (synchronous && typeof body === 'function') body();
    return real(body, ms);
  }) as typeof window.setTimeout);
  const { scope } = fixture();
  synchronous = true;
  const body = vi.fn();
  expect(() => scope!.enqueue('selection-focus', body)).toThrow();
  expect(body).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('retains failed cancellation debt and refuses another allocation', () => {
  vi.spyOn(window, 'clearTimeout').mockImplementation(() => {
    throw new Error('cancel failed');
  });
  const { owner, editor, scope } = fixture();
  scope!.close();
  expect(() => owner.port.beginMount(editor)).toThrow();
  expect(vi.getTimerCount()).toBeGreaterThan(0);
});
it.each([
  ['iPhone', 'Version/17 Mobile Safari', undefined],
  ['Linux', 'Android Chrome', undefined],
  ['MacIntel', 'Version/17 Safari', { preventScroll: true }],
] as const)(
  'preserves immediate platform focus %s and frame focus',
  async (platform, userAgent, options) => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    const { editor } = fixture();
    await vi.runAllTimersAsync();
    vi.spyOn(editor.view, 'hasFocus').mockReturnValue(false);
    const dom = vi.spyOn(editor.view.dom, 'focus');
    const focus = vi.spyOn(editor.view, 'focus');
    editor.commands.focus('end', { scrollIntoView: false });
    if (options) expect(dom).toHaveBeenCalledWith(options);
    else expect(dom).toHaveBeenCalledWith();
    expect(focus).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(focus).toHaveBeenCalledOnce();
  },
);
it('stops the frame scroll stage when view.focus closes the scope', async () => {
  const { editor, scope } = fixture();
  await vi.runAllTimersAsync();
  vi.spyOn(editor.view, 'hasFocus').mockReturnValue(false);
  vi.spyOn(editor.view, 'focus').mockImplementation(() => scope!.close());
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  editor.commands.focus('end');
  dispatch.mockClear();
  await vi.runAllTimersAsync();
  expect(dispatch).not.toHaveBeenCalled();
  await expect(scope!.settled).rejects.toThrow();
});

it('does not admit a new mount merely because tasks closed while the native view is attached', async () => {
  const { editor, scope } = fixture();
  scope!.close();
  await scope!.settled;
  expect(() => editor.mount(document.createElement('div'))).toThrow();
});
it('does not destroy the native view twice on reentrant unmount', () => {
  const { editor } = fixture();
  const destroy = editor.view.destroy.bind(editor.view);
  let entered = false;
  const calls = vi.spyOn(editor.view, 'destroy').mockImplementation(() => {
    if (!entered) {
      entered = true;
      try {
        editor.unmount();
      } catch {
        /* Reentrant refusal expected. */
      }
    }
    destroy();
  });
  editor.unmount();
  expect(calls).toHaveBeenCalledOnce();
});

it('shares one bounded pending idle observation', async () => {
  const { scope } = fixture();
  const pending = scope!.whenIdle();
  for (let i = 0; i < 100; i++) expect(scope!.whenIdle()).toBe(pending);
  await vi.runAllTimersAsync();
  await pending;
});
it('rejects thenables returned by a closing callback', async () => {
  const { scope } = fixture();
  expect(() => scope!.close(() => Promise.resolve())).toThrow(/synchronous/);
  await expect(scope!.settled).rejects.toThrow(/synchronous/);
});

it('claims cancellation before invoking a reentrant cancel function', () => {
  const real = window.clearTimeout.bind(window);
  let close: (() => void) | undefined;
  const cancel = vi.spyOn(window, 'clearTimeout').mockImplementation((handle) => {
    close?.();
    real(handle);
  });
  const { scope } = fixture();
  close = () => scope!.close();
  scope!.close();
  expect(cancel).toHaveBeenCalledOnce();
});
it('runs a closing callback at most once even after repeated close calls', () => {
  const { scope } = fixture();
  const cleanup = vi.fn();
  scope!.close(cleanup);
  try {
    scope!.close(cleanup);
  } catch {
    /* Repeated cleanup may refuse. */
  }
  expect(cleanup).toHaveBeenCalledOnce();
});

it('does not treat a synthetic create event as real task settlement', async () => {
  const { editor, scope } = fixture();
  let idle = false;
  void scope!.whenIdle().then(() => {
    idle = true;
  });
  editor.emit('create', { editor });
  await Promise.resolve();
  expect(idle).toBe(false);
  expect(editor.isInitialized).toBe(false);
  editor.unmount();
  await scope!.settled;
});
it('retains unknown allocation debt when registration throws after allocating', async () => {
  const real = window.setTimeout.bind(window);
  let reject = false;
  vi.spyOn(window, 'setTimeout').mockImplementation(((body: TimerHandler, ms?: number) => {
    const handle = real(body, ms);
    if (reject) throw new Error('registration failed after allocation');
    return handle;
  }) as typeof window.setTimeout);
  const { editor, owner, scope } = fixture();
  reject = true;
  const body = vi.fn();
  expect(() => scope!.enqueue('selection-focus', body)).toThrow(/registration/);
  let settled = false;
  void scope!.settled.then(() => {
    settled = true;
  });
  await vi.runAllTimersAsync();
  expect(body).not.toHaveBeenCalled();
  expect(settled).toBe(false);
  expect(() => owner.port.beginMount(editor)).toThrow();
  await expect(scope!.whenIdle()).rejects.toThrow(/registration/);
});
for (const [name, module] of [
  ['esm', { Editor, StarterKit }],
  ['cjs', { Editor: cjs.Editor, StarterKit: cjsStarter.StarterKit }],
] as const) {
  it.each([null, false, 'start', 'end', 2] as const)(
    `${name} preserves ordinary focus selection/marks/scroll for %s`,
    async (position) => {
      for (const owned of [false, true]) {
        const scroll = vi.fn(() => true);
        const { editor, scope } = fixture(owned, module, {
          editorProps: { handleScrollToSelection: scroll },
        });
        await vi.runAllTimersAsync();
        editor.commands.setTextSelection(2);
        editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.bold.create()]));
        vi.spyOn(editor.view, 'hasFocus').mockReturnValue(false);
        const focused = vi.spyOn(editor.view, 'focus');
        editor.commands.focus(position);
        await vi.runAllTimersAsync();
        if (scope) await scope.whenIdle();
        expect(editor.state.selection.from).toBe(
          position === 'start' ? 1 : position === 'end' ? 3 : 2,
        );
        expect(editor.state.storedMarks?.map((mark) => mark.type.name) ?? []).toEqual(
          position === 'start' || position === 'end' ? [] : ['bold'],
        );
        expect(focused.mock.calls.length).toBe(position === false ? 0 : 1);
        expect(scroll.mock.calls.length).toBe(position === false ? 0 : 1);
      }
    },
  );
}

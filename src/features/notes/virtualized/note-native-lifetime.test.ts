import { afterEach, expect, it, vi } from 'vitest';
import { SvelteRenderer } from 'svelte-tiptap';
import { unmount } from 'svelte';
import { Editor, Extension, Node, type NodeViewRenderer } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { NoteNativeLifetime } from './note-native-lifetime';
vi.mock('svelte', async (original) => ({
  ...(await original<typeof import('svelte')>()),
  unmount: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('keeps the window reservation until actual Svelte disposal settles', async () => {
  const pending = deferred();
  vi.mocked(unmount).mockReturnValue(pending.promise);
  const component = {};
  const renderer = new SvelteRenderer(component, {
    element: document.createElement('div'),
    props: {},
  });
  const lifetime = new NoteNativeLifetime();
  const removeEditorListener = vi.fn();
  const view = lifetime.track({
    dom: renderer.dom,
    renderer,
    destroy() {
      renderer.destroy();
      removeEditorListener();
    },
  });
  const release = vi.fn();
  const done = lifetime.dispose(() => view.destroy(), release);
  expect(unmount).toHaveBeenCalledExactlyOnceWith(component);
  expect(removeEditorListener).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  pending.resolve();
  await done;
  expect(release).toHaveBeenCalledOnce();
});
it('waits for native asynchronous cleanup already started by an earlier transaction', async () => {
  const pending = deferred(),
    release = vi.fn();
  const lifetime = new NoteNativeLifetime();
  const destroy = vi.fn(() => pending.promise);
  const view = lifetime.track({ dom: document.createElement('div'), destroy });
  view.destroy();
  const done = lifetime.dispose(() => {}, release);
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  pending.resolve();
  await done;
  expect(destroy).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});
it('cleans constructed node views after a failed mount and retains credit on cleanup failure', async () => {
  const lifetime = new NoteNativeLifetime(),
    release = vi.fn();
  const failed = new Error('native cleanup failed');
  const destroy = vi.fn(() => {
    throw failed;
  });
  lifetime.track({ dom: document.createElement('div'), destroy });
  await expect(lifetime.dispose(() => {}, release)).rejects.toBe(failed);
  expect(destroy).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
});

it('tracks factories inside bundled extensions without duplicating their registration', async () => {
  const pending = deferred(),
    release = vi.fn(),
    destroyed = vi.fn(() => pending.promise);
  const factory = vi.fn(() => ({ dom: document.createElement('div'), destroy: destroyed }));
  const atom = Node.create({
    name: 'nativeAtom',
    group: 'block',
    atom: true,
    addNodeView: () => factory,
    renderHTML: () => ['div'],
  });
  const bundle = Extension.create({ name: 'nativeBundle', addExtensions: () => [atom] });
  const lifetime = new NoteNativeLifetime();
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: lifetime.extensions([Document, Text, bundle]),
    content: { type: 'doc', content: [{ type: 'nativeAtom' }] },
  });
  expect(factory).toHaveBeenCalledOnce();
  expect(
    editor.extensionManager.extensions.filter((item) => item.name === 'nativeAtom'),
  ).toHaveLength(1);
  const done = lifetime.dispose(() => editor.destroy(), release);
  expect(destroyed).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
  pending.resolve();
  await done;
  expect(release).toHaveBeenCalledOnce();
});
it('remembers a rejected unmount even when it settles before the editor retires', async () => {
  const pending = deferred(),
    release = vi.fn();
  const lifetime = new NoteNativeLifetime();
  const failed = new Error('asynchronous disposal failed');
  const view = lifetime.track({
    dom: document.createElement('div'),
    destroy: () => pending.promise,
  });
  view.destroy();
  pending.reject(failed);
  await Promise.resolve();
  await Promise.resolve();
  const done = lifetime.dispose(() => {}, release);
  await expect(done).rejects.toBe(failed);
  expect(lifetime.dispose(() => {}, release)).toBe(done);
  expect(release).not.toHaveBeenCalled();
});

function nativeFactoryFixture() {
  const lifetime = new NoteNativeLifetime();
  const factory = vi.fn<NodeViewRenderer>(() => ({
    dom: document.createElement('span'),
    destroy: vi.fn(),
  }));
  const atom = Node.create({
    name: 'ownedAtom',
    group: 'block',
    atom: true,
    addNodeView: () => factory,
    renderHTML: () => ['span'],
  });
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: lifetime.extensions([Document, Text, atom]),
    content: { type: 'doc', content: [{ type: 'ownedAtom' }] },
  });
  const configured = editor.extensionManager.nodeViews.ownedAtom;
  // Invoke the actual configured wrapper with the original native factory inputs.
  const props = factory.mock.calls[0][0];
  const invoke = () =>
    configured(props.node, props.view, props.getPos, props.decorations, props.innerDecorations);
  return { lifetime, factory, editor, invoke };
}

it('refuses closed lifetime before the actual configured factory runs', async () => {
  const f = nativeFactoryFixture();
  await f.lifetime.dispose(
    () => f.editor.destroy(),
    () => {},
  );
  const calls = f.factory.mock.calls.length;
  expect(() => f.invoke()).toThrow('Cannot construct a retired note view');
  expect(f.factory).toHaveBeenCalledTimes(calls);
});

it.each(['settle', 'reject'] as const)(
  'owns a product returned after reentrant disposal until cleanup can %s',
  async (outcome) => {
    const f = nativeFactoryFixture(),
      pending = deferred(),
      release = vi.fn();
    const failed = new Error('controlled product cleanup failed');
    const destroy = vi.fn(() => pending.promise);
    let completion: Promise<void> | undefined;
    let result: Promise<unknown> | undefined;
    f.factory.mockImplementationOnce(() => {
      completion = f.lifetime.dispose(() => f.editor.destroy(), release);
      result = completion.catch((error: unknown) => error);
      return { dom: document.createElement('span'), destroy };
    });
    try {
      expect(() => f.invoke()).toThrow('Cannot construct a retired note view');
      await Promise.resolve();
      await Promise.resolve();
      expect(destroy).toHaveBeenCalledOnce();
      expect(release).not.toHaveBeenCalled();
      const calls = f.factory.mock.calls.length;
      expect(() => f.invoke()).toThrow();
      expect(f.factory).toHaveBeenCalledTimes(calls);
      if (outcome === 'settle') pending.resolve();
      else pending.reject(failed);
      expect(await result).toBe(outcome === 'reject' ? failed : undefined);
      expect(release).toHaveBeenCalledTimes(outcome === 'settle' ? 1 : 0);
      expect(f.lifetime.dispose(() => {}, release)).toBe(completion);
    } finally {
      pending.resolve();
      await result;
      f.editor.destroy();
    }
  },
);

it('rejects reentrant factory admission before invoking another factory', async () => {
  const f = nativeFactoryFixture();
  const destroy = vi.fn();
  f.factory.mockImplementationOnce(() => {
    expect(() => f.invoke()).toThrow();
    return { dom: document.createElement('span'), destroy };
  });
  try {
    f.invoke();
    expect(f.factory).toHaveBeenCalledTimes(2);
  } finally {
    await f.lifetime.dispose(
      () => f.editor.destroy(),
      () => {},
    );
  }
  expect(destroy).toHaveBeenCalledOnce();
});

it('retains failed construction debt without claiming cleanup of an unreturned product', async () => {
  const f = nativeFactoryFixture(),
    release = vi.fn();
  const failed = new Error('factory threw without returning a product');
  f.factory.mockImplementationOnce(() => {
    throw failed;
  });
  expect(() => f.invoke()).toThrow(failed);
  const calls = f.factory.mock.calls.length;
  expect(() => f.invoke()).toThrow();
  expect(f.factory).toHaveBeenCalledTimes(calls);
  await expect(f.lifetime.dispose(() => f.editor.destroy(), release)).rejects.toBe(failed);
  expect(release).not.toHaveBeenCalled();
});

it('publishes one disposal completion before invoking reentrant destroy callbacks', async () => {
  const lifetime = new NoteNativeLifetime(),
    release = vi.fn(),
    secondRelease = vi.fn();
  let nested: Promise<void> | undefined;
  const outer = lifetime.dispose(() => {
    nested = lifetime.dispose(() => {}, secondRelease);
  }, release);
  expect(nested).toBe(outer);
  await outer;
  expect(release).toHaveBeenCalledOnce();
  expect(secondRelease).not.toHaveBeenCalled();
});

it('retains cleanup debt when a returned native product refuses its destroy wrapper', async () => {
  const f = nativeFactoryFixture(),
    pending = deferred(),
    release = vi.fn();
  const destroy = vi.fn(() => pending.promise);
  f.factory.mockImplementationOnce(() =>
    Object.freeze({ dom: document.createElement('span'), destroy }),
  );
  expect(() => f.invoke()).toThrow(TypeError);
  const result = f.lifetime
    .dispose(() => f.editor.destroy(), release)
    .catch((error: unknown) => error);
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    pending.resolve();
    expect(await result).toBeInstanceOf(TypeError);
    expect(release).not.toHaveBeenCalled();
  } finally {
    pending.resolve();
    await result;
    f.editor.destroy();
  }
});

// @verify-changed-triggers: package.json, pnpm-lock.yaml, patches/@tiptap__core@3.31.3.patch
/** Actual configured callbacks under controlled jsdom clocks; no native authority or browser-focus claim. */
import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createEditorConfig } from './editor-config';
import { createEditorDeferredTasks } from './editor-deferred-tasks';
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) {
    try {
      editor.destroy();
    } catch {
      /* Retired owner. */
    }
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function fixture(owned = true, onUpdate = vi.fn()) {
  vi.useFakeTimers();
  const owner = createEditorDeferredTasks();
  const element = document.createElement('div');
  document.body.append(element);
  const config = createEditorConfig({
    element,
    content: '<p>ab</p>',
    editable: true,
    onUpdate,
    useMarkdown: true,
    ...(owned ? { deferredTasks: owner.port } : {}),
  });
  const editor = new Editor(config);
  editors.push(editor);
  return {
    editor,
    owner,
    onUpdate,
    scope: owned ? editor.captureDeferredTasks(editor.view)! : undefined,
  };
}
it.each([false, true])(
  'constructs the actual configured editor and dispatches preserved-selection tasks (owned %s)',
  async (owned) => {
    const { editor, scope } = fixture(owned);
    await vi.runAllTimersAsync();
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    editor.emit('focus', { editor, event: new FocusEvent('focus'), transaction: editor.state.tr });
    expect(dispatch).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(
      dispatch.mock.calls.some(([tr]) => tr.getMeta('selectionPreservation') === 'focus'),
    ).toBe(true);
    editor.commands.setTextSelection({ from: 1, to: 3 });
    dispatch.mockClear();
    editor.emit('blur', { editor, event: new FocusEvent('blur'), transaction: editor.state.tr });
    await vi.runAllTimersAsync();
    expect(dispatch.mock.calls.some(([tr]) => tr.getMeta('selectionPreservation') === 'blur')).toBe(
      true,
    );
    if (scope) await scope.whenIdle();
  },
);
it('owns focused update and its nested focus frame with original selection', async () => {
  const { editor, scope, onUpdate } = fixture();
  await vi.runAllTimersAsync();
  editor.commands.setTextSelection(2);
  vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
  editor.commands.insertContent('X');
  expect(onUpdate).toHaveBeenCalled();
  const expected = editor.state.selection;
  await vi.runAllTimersAsync();
  await scope!.whenIdle();
  expect(editor.getText()).toBe('aXb');
  expect(editor.state.selection.eq(expected)).toBe(true);
});
it('refuses scheduling after external onUpdate closes the owner', async () => {
  let retire: (() => void) | undefined;
  const { editor, owner, scope } = fixture(
    true,
    vi.fn(() => retire?.()),
  );
  await vi.runAllTimersAsync();
  retire = owner.retire;
  vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
  const focus = vi.spyOn(editor.view, 'focus');
  expect(() => editor.commands.insertContent('X')).toThrow();
  // ProseMirror may retain its own DOM-observer timer; this owner covers named tasks only.
  await vi.runAllTimersAsync();
  expect(focus).not.toHaveBeenCalled();
  await expect(scope!.settled).rejects.toThrow();
});
it('cancels queued SelectionPreservation work before native dispatch', async () => {
  const { editor, scope } = fixture();
  await vi.runAllTimersAsync();
  editor.emit('focus', { editor, event: new FocusEvent('focus'), transaction: editor.state.tr });
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  scope!.close();
  await vi.runAllTimersAsync();
  expect(dispatch).not.toHaveBeenCalled();
});
it('does not reinterpret cancellation as the update focus-end fallback', async () => {
  const { editor, scope } = fixture();
  await vi.runAllTimersAsync();
  const hasFocus = vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
  // Invoke the actual configured event callback without introducing an unrelated PM observer timer.
  editor.emit('update', { editor, transaction: editor.state.tr, appendedTransactions: [] });
  hasFocus.mockImplementation(() => {
    scope!.close();
    return false;
  });
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  await vi.runAllTimersAsync();
  expect(dispatch).not.toHaveBeenCalled();
  await expect(scope!.settled).rejects.toThrow();
});

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import {
  prepareNoteDeleteEditors,
  registerNoteDeleteEditor,
} from '$features/notes/note-delete-editors';

const gate = vi.hoisted(() => ({
  held: false,
  generation: 1,
  listeners: new Set<(held: boolean) => void>(),
  drafts: vi.fn((_draft: unknown) => true),
  input: vi.fn(),
  release: vi.fn(),
  reserve: vi.fn<() => (() => void) | undefined>(),
  dispatch: vi.fn(),
  settle: vi.fn(async () => {}),
}));
vi.mock('$features/notes/note-delete-gate', () => ({
  isNoteDeleteHeld: () => gate.held,
  subscribeNoteDeleteHold: (_ws: string, _note: string, listener: (held: boolean) => void) => {
    listener(gate.held);
    gate.listeners.add(listener);
    return () => gate.listeners.delete(listener);
  },
  retainNoteDeleteDraft: gate.drafts,
  reserveNoteDeleteDraft: gate.reserve,
  notifyNoteDeleteInput: gate.input,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ daemonHealth: { connectionGeneration: gate.generation } }),
    dispatch(action: any) {
      gate.dispatch(action);
      if (action.asyncActionType === 'workspaceNotes/settleNoteContentRequested') {
        void gate.settle().then(action.success, action.failure);
      }
      return action;
    },
  });
});
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectHasPendingNoteContent: { select: () => false },
  selectNoteById: { select: () => ({ id: 'note' }) },
}));
vi.mock('$features/notes/notes-write-service', () => ({
  subscribeNoteContentFailure: () => () => {},
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: () => ({
    subscribe: (run: (v: boolean) => void) => {
      run(true);
      return () => {};
    },
  }),
}));
vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));
import RawNoteCodeEditor from '../RawNoteCodeEditor.svelte';

const scope = { backendGeneration: 1, workspaceId: 'ws', noteId: 'note' };
const dispose: Array<() => void> = [];
const updates = () =>
  gate.dispatch.mock.calls
    .map(([action]) => action)
    .filter((a) => a.type === 'workspaceNotes/updateNoteContent');
function mount(content = 'original', rev = 4) {
  const view = render(RawNoteCodeEditor, {
    workspaceId: scope.workspaceId,
    noteId: scope.noteId,
    content,
    rev,
  });
  const component = view.component;
  const registration = registerNoteDeleteEditor(scope, {
    current: () => component.getDeleteState().current,
    version: () => component.getDeleteState().version,
    dirty: () => component.getDeleteState().dirty,
    composing: () => component.getDeleteState().composing,
    hold: component.setDeletionHeld,
    flush: component.flushForDeletion,
  });
  dispose.push(registration.unregister);
  return {
    ...view,
    input: view.container.querySelector('[data-testid=code-editor]') as HTMLTextAreaElement,
  };
}
beforeEach(() => {
  gate.held = false;
  gate.release.mockClear();
  gate.reserve.mockReset().mockImplementation(() => gate.release);
  gate.generation = 1;
  gate.drafts.mockClear();
  gate.dispatch.mockClear();
  gate.input.mockClear();
  gate.settle.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  dispose
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  gate.listeners.clear();
  vi.useRealTimers();
});

describe('raw note delete hold', () => {
  it('retains actual model input during the synchronous readonly tick gap and aborts before saving', async () => {
    const view = mount();
    const preparing = prepareNoteDeleteEditors(scope);
    const rejected = expect(preparing).rejects.toThrow();
    // The model callback is deliberately allowed through before Svelte reflects readOnly.
    view.input.value = 'original gap input';
    view.input.dispatchEvent(new Event('input', { bubbles: true }));
    await rejected;
    expect(view.input.value).toBe('original gap input');
    expect(updates()).toEqual([]);
    expect(view.component.getDeleteState().dirty).toBe(true);
    view.component.flushPendingSave();
    expect(updates()[0].payload).toEqual([
      'ws',
      'note',
      'original gap input',
      { immediate: true, strict: true, baseRev: 4, baseContent: 'original' },
    ]);
  });

  it('starts read-only when no recovery slot is available and retries admission before accepting edits', async () => {
    gate.reserve.mockReturnValueOnce(undefined);
    const view = mount();
    expect(view.input.readOnly).toBe(true);
    expect(view.component.getDeleteState().current).toBe(false);
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    expect(updates()).toEqual([]);
    await fireEvent.click(view.getByRole('button'));
    expect(view.input.readOnly).toBe(false);
    await fireEvent.input(view.input, { target: { value: 'admitted draft' } });
    view.component.flushPendingSave();
    expect(updates()[0].payload[2]).toBe('admitted draft');
  });

  it('retains a held draft before releasing its reserved slot', async () => {
    const order: string[] = [];
    gate.drafts.mockImplementationOnce(() => {
      order.push('retain');
      return true;
    });
    gate.release.mockImplementationOnce(() => {
      order.push('release');
    });
    const view = mount();
    await fireEvent.input(view.input, { target: { value: 'draft before unmount' } });
    gate.held = true;
    gate.listeners.forEach((listener) => listener(true));
    view.unmount();
    expect(order).toEqual(['retain', 'release']);
  });

  it('inherits the rich owner reservation for an initial draft without requesting another slot', async () => {
    gate.reserve.mockReturnValue(undefined);
    const view = render(RawNoteCodeEditor, {
      workspaceId: 'ws',
      noteId: 'note',
      content: 'base',
      rev: 4,
      recoveryOwnerId: 'rich-owner',
      recoveryAdmitted: true,
      initialDraft: {
        content: 'rich handoff',
        baseContent: 'base',
        rev: 4,
        selection: { anchor: 0, head: 0 },
      },
    });
    expect(gate.reserve).not.toHaveBeenCalled();
    const input = view.getByTestId('code-editor') as HTMLTextAreaElement;
    expect(input.readOnly).toBe(false);
    gate.held = true;
    gate.listeners.forEach((listener) => listener(true));
    view.unmount();
    expect(gate.drafts).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'rich-owner',
        content: 'rich handoff',
        baseContent: 'base',
        rev: 4,
      }),
    );
    expect(gate.release).not.toHaveBeenCalled();
  });

  it('holds raw input until its real settle promise succeeds', async () => {
    const view = mount();
    await fireEvent.input(view.input, { target: { value: 'original draft' } });
    let acknowledge!: () => void;
    gate.settle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    let done = false;
    const preparing = prepareNoteDeleteEditors(scope).then((lease) => {
      done = true;
      return lease;
    });
    await tick();
    await vi.waitFor(() => expect(gate.settle).toHaveBeenCalled());
    expect(done).toBe(false);
    expect(view.input.readOnly).toBe(true);
    expect(updates()[0].payload[3]).toEqual({
      immediate: true,
      strict: true,
      baseRev: 4,
      baseContent: 'original',
    });
    acknowledge();
    const lease = await preparing;
    dispose.push(lease.release);
    expect(lease.current()).toBe(true);
    expect(view.input.readOnly).toBe(true);
  });

  it('keeps distinct original bases on remote-held unmount and sends no teardown save', async () => {
    const first = mount('base one', 4);
    const second = mount('base two', 9);
    await fireEvent.input(first.input, { target: { value: 'first draft' } });
    await fireEvent.input(second.input, { target: { value: 'second draft' } });
    gate.held = true;
    gate.listeners.forEach((listener) => listener(true));
    first.unmount();
    second.unmount();
    expect(updates()).toEqual([]);
    const drafts = gate.drafts.mock.calls.map(([draft]) => draft as any);
    expect(drafts).toEqual([
      expect.objectContaining({
        content: 'first draft',
        baseContent: 'base one',
        rev: 4,
        backendGeneration: 1,
      }),
      expect.objectContaining({
        content: 'second draft',
        baseContent: 'base two',
        rev: 9,
        backendGeneration: 1,
      }),
    ]);
    expect(drafts[0].ownerId).not.toBe(drafts[1].ownerId);
  });

  it('retains the original raw owner if props rebind while a deletion hold is active', async () => {
    const view = mount();
    await fireEvent.input(view.input, { target: { value: 'old owner draft' } });
    view.component.setDeletionHeld(true);
    await view.rerender({
      workspaceId: 'replacement',
      noteId: 'replacement',
      content: 'replacement source',
      rev: 20,
    });
    await fireEvent.input(view.input, { target: { value: 'old owner draft gap' } });
    view.unmount();
    expect(updates()).toEqual([]);
    expect(gate.drafts).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws',
        noteId: 'note',
        content: 'old owner draft gap',
        baseContent: 'original',
        rev: 4,
      }),
    );
  });

  it('resumes the preserved raw draft after a confirmed hold release without adopting remote text', async () => {
    const view = mount();
    await fireEvent.input(view.input, { target: { value: 'original unsaved' } });
    gate.held = true;
    gate.listeners.forEach((listener) => listener(true));
    await view.rerender({ workspaceId: 'ws', noteId: 'note', content: 'remote edit', rev: 7 });
    gate.held = false;
    gate.listeners.forEach((listener) => listener(false));
    await tick();
    expect(view.input.value).toBe('original unsaved');
    view.component.flushPendingSave();
    expect(updates()[0].payload).toEqual([
      'ws',
      'note',
      'original unsaved',
      { immediate: true, strict: true, baseContent: 'original', baseRev: 4 },
    ]);
  });

  it('rejects raw IME composition without scheduling a save', async () => {
    const view = mount();
    await fireEvent.compositionStart(view.input);
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    expect(updates()).toEqual([]);
  });

  it('preserves a post-prepare model mutation for reconciliation instead of saving through the hold', async () => {
    const view = mount();
    const lease = await prepareNoteDeleteEditors(scope);
    dispose.push(lease.release);
    gate.held = true;
    gate.listeners.forEach((listener) => listener(true));
    await fireEvent.input(view.input, { target: { value: 'late programmatic input' } });
    expect(lease.current()).toBe(false);
    expect(gate.input).toHaveBeenCalledWith(expect.objectContaining(scope));
    view.unmount();
    expect(updates()).toEqual([]);
    expect(gate.drafts).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'late programmatic input',
        baseContent: 'original',
        rev: 4,
      }),
    );
  });

  it('does not save an old-backend draft into an identical note on a new backend', async () => {
    const view = mount();
    await fireEvent.input(view.input, { target: { value: 'old backend draft' } });
    gate.generation = 2;
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    view.unmount();
    expect(updates()).toEqual([]);
    expect(gate.drafts).toHaveBeenCalledWith(
      expect.objectContaining({ backendGeneration: 1, content: 'old backend draft' }),
    );
  });
});

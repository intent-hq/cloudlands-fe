/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: only the wire is stubbed. The raw editor drives the REAL write
// service against the REAL configured store, so the draft chain (base rev,
// echo rebase, pending replay) is exercised end to end.
vi.mock('$lib/client', () => ({
  appClient: { notes: { update: vi.fn(), list: vi.fn(async () => []) } },
}));
vi.mock('svelte-sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: () => ({
    subscribe(run: (value: boolean) => void) {
      run(true);
      return () => {};
    },
  }),
}));
vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockCodeEditor.svelte'))
    .default,
}));

import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { flushNoteContent } from '$features/notes/notes-write-service';
import RawNoteCodeEditor from '../RawNoteCodeEditor.svelte';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};

const WS = 'ws-raw-editor-svc';
const NOTE = 'n';

function seed(content: string, rev: number) {
  const note: Note = {
    id: NoteId(NOTE),
    workspaceId: WorkspaceId(WS),
    title: 'N',
    content,
    contentType: ContentType.Markdown,
    visibility: NoteVisibility.Workspace,
    tags: [],
    isPinned: false,
    isArchived: false,
    createdAt: 'now',
    updatedAt: 'now',
    rev,
  };
  appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [note] }));
}

beforeAll(() => appStore.init());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Conversion-returned content may differ from the draft. While save 1 is in flight, a refetch lands a newer
// rev, so its echo is superseded and the pending draft is rebased onto the
// echo text — but the editor still shows the pre-rebase text. A keystroke
// typed on that text must be replayed onto the rebased draft; read as derived
// from it instead, it deletes the echoed agent change and the next exact write
// sends that deletion to the daemon.
it('replays a draft typed before a superseded echo onto the rebased pending draft', async () => {
  vi.useFakeTimers();
  seed('body', 4);
  const wire = vi.mocked(appClient.notes.update);
  wire.mockReset();
  let resolveFirst!: (value: unknown) => void;
  let resolveSecond!: (value: unknown) => void;
  wire.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)) as never);
  wire.mockReturnValueOnce(new Promise((r) => (resolveSecond = r)) as never);
  wire.mockImplementation((async (_id: string, content: string, rev: number) => {
    expect(rev).toBe(9);
    return { content, rev: 10 };
  }) as never);

  const view = render(RawNoteCodeEditor, {
    workspaceId: WS,
    noteId: NOTE,
    content: 'body',
    rev: 4,
  });
  const input = view.getByTestId('code-editor') as HTMLTextAreaElement;
  const syncStore = async () => {
    const note = selectNoteById.select(appStore.state, WS, NOTE)!;
    await view.rerender({ workspaceId: WS, noteId: NOTE, content: note.content, rev: note.rev });
  };

  await fireEvent.input(input, { target: { value: 'body first' } });
  await vi.advanceTimersByTimeAsync(1000);
  await syncStore();
  const first = flushNoteContent(WS, NOTE);
  await Promise.resolve();
  expect(wire).toHaveBeenLastCalledWith(NOTE, 'body first', 4, WS);

  await fireEvent.input(input, { target: { value: 'body first second' } });
  await vi.advanceTimersByTimeAsync(1000);
  await syncStore();
  await fireEvent.input(input, { target: { value: 'body first second third' } });
  seed('AGENT body first LATER', 8);
  await syncStore();
  expect(input.value).toBe('body first second third');

  resolveFirst({ content: 'AGENT body first', rev: 6 });
  await first;
  await tick();
  await syncStore();
  expect(input.value).toBe('body first second third');

  await fireEvent.input(input, { target: { value: input.value + ' fourth' } });
  await vi.advanceTimersByTimeAsync(1000);
  expect(wire).toHaveBeenLastCalledWith(NOTE, 'AGENT body first second', 6, WS);

  resolveSecond({ content: 'AGENT body first second LATER', rev: 9 });
  await flushNoteContent(WS, NOTE);
  await syncStore();

  expect(wire).toHaveBeenCalledTimes(3);
  const finalWire = wire.mock.calls.at(-1)?.[1];
  expect(finalWire).toContain('AGENT');
  expect(finalWire).toContain('second third fourth');
  expect(selectNoteById.select(appStore.state, WS, NOTE)?.content).toContain('AGENT');
  expect(input.value).toContain('AGENT');
  for (const call of wire.mock.calls) expect(call[2]).toEqual(expect.any(Number));
});

it('saves a complete oversized handoff against its original revision, then reopens and edits again', async () => {
  vi.useFakeTimers();
  const base = 'HEAD\n' + '漢字 preserve spaces  \n'.repeat(30_000) + 'TAIL';
  const draft = base + ' rich growth';
  seed(base, 20);
  const wire = vi.mocked(appClient.notes.update);
  wire.mockReset();
  let rev = 20;
  wire.mockImplementation((async (_id: string, content: string) => ({
    content,
    rev: ++rev,
  })) as never);
  const view = render(RawNoteCodeEditor, {
    workspaceId: WS,
    noteId: NOTE,
    content: base,
    rev: 20,
    initialDraft: {
      content: draft,
      baseContent: base,
      rev: 20,
      selection: { anchor: draft.length, head: draft.length },
    },
  });
  expect((view.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe(draft);
  await vi.advanceTimersByTimeAsync(1000);
  await flushNoteContent(WS, NOTE);
  expect(wire).toHaveBeenCalledExactlyOnceWith(NOTE, draft, 20, WS);
  view.unmount();
  const saved = selectNoteById.select(appStore.state, WS, NOTE)!;
  const reopened = render(RawNoteCodeEditor, {
    workspaceId: WS,
    noteId: NOTE,
    content: saved.content,
    rev: saved.rev,
  });
  const input = reopened.getByTestId('code-editor') as HTMLTextAreaElement;
  expect(input.value).toBe(draft);
  await fireEvent.input(input, { target: { value: draft + ' second edit' } });
  await vi.advanceTimersByTimeAsync(1000);
  await flushNoteContent(WS, NOTE);
  expect(wire).toHaveBeenLastCalledWith(NOTE, draft + ' second edit', 21, WS);
  expect(selectNoteById.select(appStore.state, WS, NOTE)?.content).toBe(draft + ' second edit');
});

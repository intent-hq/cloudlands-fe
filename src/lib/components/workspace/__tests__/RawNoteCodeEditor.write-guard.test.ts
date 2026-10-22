/**
 * @vitest-environment jsdom
 *
 * The truncated-read write guard (§5.2) end to end on the raw editor: the REAL
 * write saga against a fake daemon that enforces `baseContentBytes` exactly as
 * the contract does (size of its stored text at `expectedVersion`). Typing
 * during an in-flight save, or after a concurrent agent edit, must never be
 * refused or lose text.
 */
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

// FAKE seam: only the wire is stubbed. The raw editor drives the REAL write
// service against the REAL configured store, so the draft chain (base rev,
// echo rebase, pending replay) is exercised end to end.
vi.mock('$lib/client', () => ({
  appClient: {
    notes: {
      setContent: vi.fn(),
      list: vi.fn(async () => []),
      // Daemon with truncated reads: every save carries baseContentBytes (§5.2).
      supportsTruncatedRead: vi.fn(async () => true),
    },
  },
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
import { startWorkspaceNotesSagaFixture } from '../../../../test/fixtures/workspace-notes-saga-fixture';
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

let stopWorkspaceNotesSaga: (() => void) | undefined;
beforeAll(() => {
  appStore.init();
  [stopWorkspaceNotesSaga] = startWorkspaceNotesSagaFixture(appStore);
});
afterAll(() => stopWorkspaceNotesSaga?.());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const enc = new TextEncoder();

/** A daemon that keeps every rev's text and refuses a write whose base size does not match. */
function makeDaemon(initial: string, rev: number) {
  const texts = new Map<number, string>([[rev, initial]]);
  let current = rev;
  const refusals: unknown[] = [];
  const write = async (
    _noteId: string,
    content: string,
    expectedVersion?: number,
    _workspaceId?: string,
    options?: { baseContentBytes?: number },
  ) => {
    const base = texts.get(expectedVersion ?? current);
    if (
      options?.baseContentBytes !== undefined &&
      (base === undefined || enc.encode(base).length !== options.baseContentBytes)
    ) {
      refusals.push({ content, expectedVersion, options });
      return { success: false, error: 'mismatch', contentBaseMismatch: true as const };
    }
    current += 1;
    texts.set(current, content);
    return { success: true, newContent: content, noteRev: current };
  };
  const agentWrite = (content: string) => {
    current += 1;
    texts.set(current, content);
    return current;
  };
  return { write, agentWrite, refusals, text: () => texts.get(current), rev: () => current };
}

function renderEditor(content: string, rev: number) {
  const view = render(RawNoteCodeEditor, { workspaceId: WS, noteId: NOTE, content, rev });
  const input = view.getByTestId('code-editor') as HTMLTextAreaElement;
  const syncStore = async () => {
    const note = selectNoteById.select(appStore.state, WS, NOTE);
    if (!note) throw new Error('note missing');
    await view.rerender({ workspaceId: WS, noteId: NOTE, content: note.content, rev: note.rev });
  };
  return { input, syncStore };
}

it('keeps typing during an in-flight save without a refusal or lost text', async () => {
  vi.useFakeTimers();
  seed('body', 4);
  const wire = vi.mocked(appClient.notes.setContent);
  wire.mockReset();
  const daemon = makeDaemon('body', 4);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  wire.mockImplementationOnce((async (...args: Parameters<typeof daemon.write>) => {
    await gate;
    return daemon.write(...args);
  }) as never);
  wire.mockImplementation(daemon.write as never);
  const { input, syncStore } = renderEditor('body', 4);

  await fireEvent.input(input, { target: { value: 'body first' } });
  await vi.advanceTimersByTimeAsync(1000);
  await syncStore();
  const first = flushNoteContent(WS, NOTE);
  await vi.waitFor(() => expect(wire).toHaveBeenCalledTimes(1));

  // The user keeps typing while save 1 is in flight; its echo lands mid-typing.
  await fireEvent.input(input, { target: { value: 'body first second' } });
  release();
  await first;
  await tick();
  await syncStore();
  await vi.advanceTimersByTimeAsync(1000);
  await flushNoteContent(WS, NOTE);
  await vi.advanceTimersByTimeAsync(5000);
  await tick();

  expect(daemon.refusals).toEqual([]);
  expect(wire.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const call of wire.mock.calls) expect(call[4]).toHaveProperty('baseContentBytes');
  expect(daemon.text()).toBe('body first second');
  expect(selectNoteById.select(appStore.state, WS, NOTE)?.content).toBe('body first second');
});

it('saves on top of a concurrent agent edit without a refusal', async () => {
  vi.useFakeTimers();
  seed('body', 10);
  const wire = vi.mocked(appClient.notes.setContent);
  wire.mockReset();
  const daemon = makeDaemon('body', 10);
  wire.mockImplementation(daemon.write as never);
  const { input, syncStore } = renderEditor('body', 10);

  // An agent rewrites the note; the event re-read lands in the store.
  const rev = daemon.agentWrite('AGENT body');
  seed('AGENT body', rev);
  await syncStore();
  await fireEvent.input(input, { target: { value: 'AGENT body MINE' } });
  await vi.advanceTimersByTimeAsync(1000);
  await flushNoteContent(WS, NOTE);
  await tick();

  expect(daemon.refusals).toEqual([]);
  expect(daemon.text()).toBe('AGENT body MINE');
  expect(wire.mock.calls.at(-1)).toEqual([
    NOTE,
    'AGENT body MINE',
    rev,
    WS,
    { baseContentBytes: enc.encode('AGENT body').length },
  ]);
});

import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import {
  loadWorkspaceNotesSucceeded,
  retryNoteContentRequested,
  settleNoteContentRequested,
  updateNoteTitle,
  updateNoteContent,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { notesWriteSaga } from './notes-write-saga';

const api = vi.hoisted(() => ({
  update: vi.fn(),
  setContent: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  updateMetadata: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { notes: api } }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), warning: vi.fn() },
}));
const tasks: Task[] = [];
const WS = 'strict-integration',
  ID = 'note';
function note(content = 'old', rev = 4): Note {
  return {
    id: NoteId(ID),
    workspaceId: WorkspaceId(WS),
    title: 'Note',
    content,
    rev,
    contentType: ContentType.Markdown,
    visibility: NoteVisibility.Workspace,
    tags: [],
    isPinned: false,
    isArchived: false,
    createdAt: '2026-10-07T00:00:00Z',
    updatedAt: '2026-10-07T00:00:00Z',
  };
}
function harness() {
  const channel = stdChannel();
  let state = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded([WS], { [WS]: [note()] }),
  );
  const task = runSaga(
    {
      channel,
      dispatch: (a) => {
        state = workspaceNotesReducer(state, a);
        return a;
      },
      getState: () => ({ workspaceNotes: state }),
    },
    notesWriteSaga,
  );
  tasks.push(task);
  return {
    state: () => state.byWorkspaceId[WS],
    retained: () => state.retainedDrafts[JSON.stringify([WS, ID])],
    send: (action: Parameters<typeof workspaceNotesReducer>[1]) => {
      state = workspaceNotesReducer(state, action);
      channel.put(action);
    },
    stage: (content: string, baseRev: number | undefined = 4) => {
      const options = { strict: true, immediate: true, baseRev };
      channel.put(updateNoteContent(WS, ID, content, options));
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.setContent.mockResolvedValue({ success: true, noteRev: 5 });
  api.list.mockResolvedValue([note()]);
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});
describe('complete editing through the landed persistence owner', () => {
  it.each(['', '\"quoted\"', '{"content":"literal JSON"}'])(
    'sends exact complete source %j with the loaded revision',
    async (content) => {
      api.update.mockResolvedValue(note(content, 5));
      const run = harness();
      run.stage(content);
      await vi.waitFor(() =>
        expect(api.update).toHaveBeenCalledExactlyOnceWith(ID, content, 4, WS),
      );
      expect(api.setContent).not.toHaveBeenCalled();
      expect(run.state()?.notes.map[ID]).toMatchObject({ content, rev: 5 });
    },
  );
  it('retains a conflicting draft and blocks subsequent automatic saves', async () => {
    api.update.mockRejectedValue(Object.assign(new Error('Note changed'), { rpcCode: -32005 }));
    const run = harness();
    run.stage('local draft');
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    run.stage('newer local draft');
    await Promise.resolve();
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(run.state()?.pendingContentByNoteId[ID]).toBe(true);
    expect(run.state()?.notes.map[ID]?.content).toBe('newer local draft');
  });
  it('accepts an exact complete reread after a lost acknowledgement without rewriting', async () => {
    api.update.mockRejectedValue(new Error('Disconnected'));
    api.get.mockResolvedValue(note('local draft', 5));
    const run = harness();
    run.stage('local draft');
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledExactlyOnceWith(ID, WS));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.setContent).not.toHaveBeenCalled();
    expect(run.state()?.pendingContentByNoteId[ID]).toBeUndefined();
    expect(run.state()?.notes.map[ID]).toMatchObject({ content: 'local draft', rev: 5 });
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('retains the newest queued draft when the first strict write conflicts and rejects settlement', async () => {
  const first = deferred<Note>();
  api.update.mockReturnValueOnce(first.promise);
  const run = harness();
  run.stage('first');
  run.stage('newest');
  first.reject(Object.assign(new Error('Note changed'), { rpcCode: -32005 }));
  await vi.waitFor(() => expect(run.retained()?.error).toBe('Note changed'));
  const settle = settleNoteContentRequested(WS, ID);
  const result = expect(settle.promise).rejects.toThrow('Note changed');
  run.send(settle);
  await result;
  expect(api.update).toHaveBeenCalledExactlyOnceWith(ID, 'first', 4, WS);
  expect(run.retained()).toMatchObject({ content: 'newest', rev: 4 });
  expect(run.state()?.pendingContentByNoteId[ID]).toBe(true);
});
it('serializes retry preflight behind metadata and rejects a changed original base', async () => {
  api.update.mockRejectedValue(Object.assign(new Error('Conflict'), { rpcCode: -32005 }));
  const run = harness();
  run.stage('draft');
  await vi.waitFor(() => expect(run.retained()?.error).toBe('Conflict'));
  const metadata = deferred<{ success: true }>();
  api.updateMetadata.mockReturnValueOnce(metadata.promise);
  run.send(updateNoteTitle(WS, ID, 'Renamed'));
  await vi.waitFor(() => expect(api.updateMetadata).toHaveBeenCalledTimes(1));
  api.get.mockResolvedValue(note('server', 5));
  const retry = retryNoteContentRequested(WS, ID);
  const result = expect(retry.promise).rejects.toThrow('Conflict');
  run.send(retry);
  await Promise.resolve();
  await Promise.resolve();
  expect(api.get).not.toHaveBeenCalled();
  metadata.resolve({ success: true });
  await result;
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(run.retained()).toMatchObject({ content: 'draft', rev: 4, error: 'Conflict' });
});
it('retains complete content through workspace cleanup and ignores a late save acknowledgement', async () => {
  const first = deferred<Note>();
  api.update.mockReturnValueOnce(first.promise);
  const run = harness();
  run.stage('complete draft');
  run.send(workspaceUnmounted(WS));
  first.resolve(note('complete draft', 5));
  await Promise.resolve();
  await Promise.resolve();
  expect(run.state()).toBeUndefined();
  expect(run.retained()).toMatchObject({
    content: 'complete draft',
    rev: 4,
    error: expect.any(String),
  });
});

it('does not clear a newer draft when retry preflight is still pending', async () => {
  api.update.mockRejectedValue(Object.assign(new Error('Conflict'), { rpcCode: -32005 }));
  const run = harness();
  run.stage('draft');
  await vi.waitFor(() => expect(run.retained()?.error).toBe('Conflict'));
  const read = deferred<Note>();
  api.get.mockReturnValueOnce(read.promise);
  const retry = retryNoteContentRequested(WS, ID);
  const outcome = expect(retry.promise).rejects.toThrow('Conflict');
  run.send(retry);
  await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  run.stage('newer draft');
  read.resolve(note());
  await outcome;
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(run.retained()).toMatchObject({ content: 'newer draft', rev: 4, error: 'Conflict' });
});
it('retries the retained exact source only against its original revision', async () => {
  api.update
    .mockRejectedValueOnce(Object.assign(new Error('Conflict'), { rpcCode: -32005 }))
    .mockResolvedValueOnce(note('draft', 5));
  const run = harness();
  run.stage('draft');
  await vi.waitFor(() => expect(run.retained()?.error).toBe('Conflict'));
  api.get.mockResolvedValueOnce(note());
  const retry = retryNoteContentRequested(WS, ID);
  run.send(retry);
  await retry.promise;
  expect(api.update.mock.calls).toEqual([
    [ID, 'draft', 4, WS],
    [ID, 'draft', 4, WS],
  ]);
  expect(run.retained()).toBeUndefined();
  expect(run.state()?.pendingContentByNoteId[ID]).toBeUndefined();
});
it('settles a retry interrupted by unmount and ignores its preflight after remount', async () => {
  api.update.mockRejectedValue(Object.assign(new Error('Conflict'), { rpcCode: -32005 }));
  const run = harness();
  run.stage('draft');
  await vi.waitFor(() => expect(run.retained()?.error).toBe('Conflict'));
  const read = deferred<Note>();
  api.get.mockReturnValueOnce(read.promise);
  const retry = retryNoteContentRequested(WS, ID);
  const outcome = expect(retry.promise).rejects.toThrow();
  run.send(retry);
  await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  run.send(workspaceUnmounted(WS));
  run.send(loadWorkspaceNotesSucceeded([WS], { [WS]: [note('remounted', 8)] }));
  read.resolve(note());
  await outcome;
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(run.retained()).toMatchObject({ content: 'draft', rev: 4, error: 'Conflict' });
  expect(run.state()?.notes.map[ID]).toMatchObject({ content: 'remounted', rev: 8 });
});
it.each(['different', 'slim', 'unsafe revision'] as const)(
  'retains an uncertain save when reread is %s',
  async (kind) => {
    api.update.mockRejectedValue(Object.assign(new Error('Reply too large'), { rpcCode: -32010 }));
    const content = kind === 'slim' ? '' : 'draft';
    api.get.mockResolvedValue({
      ...note(
        kind === 'different' ? 'remote' : content,
        kind === 'unsafe revision' ? Number.MAX_SAFE_INTEGER + 1 : 5,
      ),
      ...(kind === 'slim' ? { contentLength: 50 } : {}),
    });
    const run = harness();
    run.stage(content);
    await vi.waitFor(() => expect(run.retained()?.error).toBe('Reply too large'));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(run.retained()).toMatchObject({ content, rev: 4 });
    expect(run.state()?.pendingContentByNoteId[ID]).toBe(true);
  },
);
it('keeps later typing and the final converted revision after the earlier write returns', async () => {
  const first = deferred<Note>();
  api.update
    .mockReturnValueOnce(first.promise)
    .mockImplementationOnce(async (_id, content, rev) => note(content, rev + 1));
  const run = harness();
  run.stage('body task');
  run.stage('body task later');
  first.resolve(note('body converted', 6));
  await vi.waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
  expect(api.update).toHaveBeenLastCalledWith(ID, 'body converted later', 6, WS);
  expect(run.state()?.notes.map[ID]).toMatchObject({ content: 'body converted later', rev: 7 });
  expect(run.retained()).toBeUndefined();
});

it('retires the entire failed predecessor chain after retrying the newest queued draft', async () => {
  const first = deferred<Note>();
  api.update.mockReturnValueOnce(first.promise).mockResolvedValueOnce(note('newest', 5));
  const run = harness();
  run.stage('first');
  run.stage('newest');
  first.reject(Object.assign(new Error('Conflict'), { rpcCode: -32005 }));
  await vi.waitFor(() =>
    expect(run.retained()).toMatchObject({ content: 'newest', rev: 4, error: 'Conflict' }),
  );
  api.get.mockResolvedValueOnce(note());
  const retry = retryNoteContentRequested(WS, ID);
  run.send(retry);
  await retry.promise;
  expect(api.update.mock.calls).toEqual([
    [ID, 'first', 4, WS],
    [ID, 'newest', 4, WS],
  ]);
  expect(run.retained()).toBeUndefined();
  expect(run.state()?.pendingContentByNoteId[ID]).toBeUndefined();
  const settled = settleNoteContentRequested(WS, ID);
  run.send(settled);
  await expect(settled.promise).resolves.toBeUndefined();
});

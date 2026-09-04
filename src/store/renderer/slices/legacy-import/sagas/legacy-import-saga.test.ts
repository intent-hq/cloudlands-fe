import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ importLegacyWorkspaces: vi.fn() }));

vi.mock('$features/settings/legacy-import.client', () => ({
  importLegacyWorkspaces: mocks.importLegacyWorkspaces,
}));

import { legacyImportRequested } from '../legacy-import-slice';
import type { LegacyImportReport } from '../legacy-import-types';
import { legacyImportSaga } from './legacy-import-saga';

const report: LegacyImportReport = {
  imported: 2,
  updated: 1,
  skipped: 3,
  notes: 4,
  comments: 5,
  agents: 6,
  assets: 7,
  skipSummary: [{ id: 'ws-existing', reason: 'already in DB' }],
  compatibilityFailures: false,
  markerWritten: true,
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function harness() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    { channel, dispatch: (action) => dispatched.push(action) },
    legacyImportSaga,
  );
  return { channel, dispatched, task };
}

describe('legacyImportSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('imports with force and dispatches the full report before refreshing workspaces', async () => {
    mocks.importLegacyWorkspaces.mockResolvedValue(report);
    const { channel, dispatched, task } = harness();

    channel.put(legacyImportRequested(true));
    await settle();

    expect(mocks.importLegacyWorkspaces.mock.calls).toEqual([[true]]);
    expect(dispatched).toEqual([
      { type: 'legacyImport/succeeded', payload: [report] },
      { type: 'workspace/loadWorkspacesRequested', payload: [] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('dispatches a terminal failure without refreshing workspaces', async () => {
    mocks.importLegacyWorkspaces.mockRejectedValue('Local connection required');
    const { channel, dispatched, task } = harness();

    channel.put(legacyImportRequested(false));
    await settle();

    expect(mocks.importLegacyWorkspaces.mock.calls).toEqual([[false]]);
    expect(dispatched).toEqual([
      { type: 'legacyImport/failed', payload: ['Local connection required'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('takes the leading request and ignores overlapping imports', async () => {
    const pending = deferred<LegacyImportReport>();
    mocks.importLegacyWorkspaces.mockReturnValue(pending.promise);
    const { channel, dispatched, task } = harness();

    channel.put(legacyImportRequested(false));
    await settle();
    channel.put(legacyImportRequested(true));
    await settle();

    expect(mocks.importLegacyWorkspaces.mock.calls).toEqual([[false]]);
    expect(dispatched).toEqual([]);
    pending.resolve(report);
    await settle();
    expect(dispatched).toEqual([
      { type: 'legacyImport/succeeded', payload: [report] },
      { type: 'workspace/loadWorkspacesRequested', payload: [] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not invent a terminal action when cancelled during the daemon call', async () => {
    const pending = deferred<LegacyImportReport>();
    mocks.importLegacyWorkspaces.mockReturnValue(pending.promise);
    const { channel, dispatched, task } = harness();

    channel.put(legacyImportRequested(true));
    await settle();
    task.cancel();
    await task.toPromise();
    pending.resolve(report);
    await settle();

    expect(mocks.importLegacyWorkspaces.mock.calls).toEqual([[true]]);
    expect(dispatched).toEqual([]);
  });
});

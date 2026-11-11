import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  bulkTransferCancelRequested,
  bulkTransferFinished,
  bulkTransferItemFailed,
  bulkTransferItemStarted,
  bulkTransferItemSucceeded,
  bulkTransferProgressReceived,
  bulkTransferSizeFailed,
  bulkTransferSizeLoaded,
  bulkTransferStartRequested,
  closeBulkTransferModal,
  openBulkTransferModal,
  selectBulkTransferTarget,
  setBulkTransferArchiveSource,
  setBulkTransferRestartAgents,
  workspaceBulkTransferReducer as reduce,
} from './workspace-bulk-transfer-slice';
import type { WorkspaceBulkTransferState } from './workspace-bulk-transfer-types';

type Action = Parameters<typeof reduce>[1];
const run = (...actions: Action[]) =>
  actions.reduce<WorkspaceBulkTransferState>(
    (state, action) => reduce(state, action),
    reduce(undefined, { type: '@@init' }),
  );
const open = openBulkTransferModal({
  workspaces: [
    { workspaceId: 'a', title: 'A' },
    { workspaceId: 'b', title: 'B' },
  ],
});
const statuses = (state: WorkspaceBulkTransferState) =>
  getItems(state.items).map((item) => item.status);

describe('workspaceBulkTransferReducer', () => {
  it('starts closed with archive on and agent restart off', () => {
    const state = run();
    expect(state.open).toBe(false);
    expect(state.archiveSource).toBe(true);
    expect(state.restartAgents).toBe(false);
    expect(getItems(state.items)).toEqual([]);
  });

  it('opens with every selected workspace pending and its size loading, in order', () => {
    const state = run(open);
    expect(state.open).toBe(true);
    expect(state.step).toBe('setup');
    expect(getItems(state.items).map((item) => [item.workspaceId, item.sizeStatus])).toEqual([
      ['a', 'loading'],
      ['b', 'loading'],
    ]);
  });

  it('records loaded and failed size estimates per workspace', () => {
    const state = run(
      open,
      bulkTransferSizeLoaded({ workspaceId: 'a', sizeBytes: 10 }),
      bulkTransferSizeFailed({ workspaceId: 'b' }),
      bulkTransferSizeLoaded({ workspaceId: 'gone', sizeBytes: 5 }),
    );
    expect(getItems(state.items).map((item) => [item.sizeStatus, item.sizeBytes])).toEqual([
      ['loaded', 10],
      ['error', null],
    ]);
  });

  it('starts only from setup with a destination', () => {
    expect(run(open, bulkTransferStartRequested()).step).toBe('setup');
    expect(run(bulkTransferStartRequested()).step).toBe('setup');
    expect(run(open, selectBulkTransferTarget('dest'), bulkTransferStartRequested()).step).toBe(
      'transferring',
    );
  });

  it('freezes the destination and options once the run starts', () => {
    const state = run(
      open,
      selectBulkTransferTarget('dest'),
      bulkTransferStartRequested(),
      selectBulkTransferTarget('other'),
      setBulkTransferRestartAgents(true),
      setBulkTransferArchiveSource(false),
    );
    expect(state.connectionId).toBe('dest');
    expect(state.restartAgents).toBe(false);
    expect(state.archiveSource).toBe(true);
  });

  it('ignores open and close while a run is in progress', () => {
    const running = run(open, selectBulkTransferTarget('dest'), bulkTransferStartRequested());
    expect(reduce(running, closeBulkTransferModal())).toBe(running);
    expect(
      reduce(running, openBulkTransferModal({ workspaces: [{ workspaceId: 'z', title: 'Z' }] })),
    ).toBe(running);
  });

  it('tracks progress only for the running workspace', () => {
    const progress = { phase: 'relaying' as const, bytesDown: 1, bytesUp: 0, chunksDone: 0 };
    expect(run(open, bulkTransferProgressReceived(progress)).progress).toBeNull();
    const state = run(
      open,
      selectBulkTransferTarget('dest'),
      bulkTransferStartRequested(),
      bulkTransferItemStarted('a'),
      bulkTransferProgressReceived(progress),
    );
    expect(state.currentId).toBe('a');
    expect(state.progress).toEqual(progress);
  });

  it('marks outcomes, accepts cancel only while running, and skips unfinished work at the end', () => {
    const base = [open, selectBulkTransferTarget('dest')] as const;
    expect(run(...base, bulkTransferCancelRequested()).cancelling).toBe(false);
    const state = run(
      ...base,
      bulkTransferStartRequested(),
      bulkTransferItemStarted('a'),
      bulkTransferItemFailed({ workspaceId: 'a', error: 'boom' }),
      bulkTransferItemStarted('b'),
      bulkTransferCancelRequested(),
    );
    expect(state.cancelling).toBe(true);
    expect(statuses(state)).toEqual(['failed', 'running']);
    const finished = reduce(state, bulkTransferFinished());
    expect(finished.step).toBe('result');
    expect(statuses(finished)).toEqual(['failed', 'skipped']);
    expect(getItems(finished.items)[0]?.error).toBe('boom');
    expect(statuses(run(...base, bulkTransferItemSucceeded('b')))).toEqual(['pending', 'done']);
  });

  it('resets on close after the run', () => {
    const done = run(
      open,
      selectBulkTransferTarget('dest'),
      bulkTransferStartRequested(),
      bulkTransferFinished(),
    );
    expect(reduce(done, closeBulkTransferModal()).open).toBe(false);
  });
});

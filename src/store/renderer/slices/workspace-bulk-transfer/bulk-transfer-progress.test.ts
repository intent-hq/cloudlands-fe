import { describe, expect, it } from 'vitest';
import { bulkTransferEstimate, bulkTransferFraction } from './bulk-transfer-progress';
import type { BulkTransferItem } from './workspace-bulk-transfer-types';

function item(overrides: Partial<BulkTransferItem> & { workspaceId: string }): BulkTransferItem {
  return {
    title: overrides.workspaceId,
    sizeStatus: 'loaded',
    sizeBytes: 100,
    status: 'pending',
    error: null,
    ...overrides,
  };
}

describe('bulkTransferEstimate', () => {
  it('sums loaded estimates and reports when every size is known', () => {
    expect(
      bulkTransferEstimate([
        item({ workspaceId: 'a', sizeBytes: 100 }),
        item({ workspaceId: 'b', sizeBytes: 300 }),
      ]),
    ).toEqual({ bytes: 400, complete: true, loading: false });
  });

  it('marks the total partial while sizes load or after a size fails', () => {
    expect(
      bulkTransferEstimate([
        item({ workspaceId: 'a', sizeBytes: 100 }),
        item({ workspaceId: 'b', sizeStatus: 'loading', sizeBytes: null }),
      ]),
    ).toEqual({ bytes: 100, complete: false, loading: true });
    expect(
      bulkTransferEstimate([
        item({ workspaceId: 'a', sizeBytes: 100 }),
        item({ workspaceId: 'b', sizeStatus: 'error', sizeBytes: null }),
      ]),
    ).toEqual({ bytes: 100, complete: false, loading: false });
  });
});

describe('bulkTransferFraction', () => {
  it('is zero before anything runs', () => {
    expect(
      bulkTransferFraction([item({ workspaceId: 'a' }), item({ workspaceId: 'b' })], null, null),
    ).toBe(0);
  });

  it('weights finished workspaces by their size estimate', () => {
    const items = [
      item({ workspaceId: 'a', sizeBytes: 300, status: 'done' }),
      item({ workspaceId: 'b', sizeBytes: 100, status: 'pending' }),
    ];
    expect(bulkTransferFraction(items, null, null)).toBe(0.75);
  });

  it('counts failed and skipped workspaces as finished', () => {
    const items = [
      item({ workspaceId: 'a', status: 'failed' }),
      item({ workspaceId: 'b', status: 'skipped' }),
      item({ workspaceId: 'c' }),
      item({ workspaceId: 'd' }),
    ];
    expect(bulkTransferFraction(items, null, null)).toBe(0.5);
  });

  it('adds the running workspace relay fraction (download + upload against twice the archive)', () => {
    const items = [
      item({ workspaceId: 'a', status: 'done' }),
      item({ workspaceId: 'b', status: 'running' }),
    ];
    const fraction = bulkTransferFraction(items, 'b', {
      phase: 'relaying',
      bytesTotal: 1000,
      bytesDown: 1000,
      bytesUp: 0,
      chunksDone: 1,
    });
    expect(fraction).toBe(0.75);
  });

  it('adds nothing for a running workspace still building or without a sealed size', () => {
    const items = [item({ workspaceId: 'a', status: 'running' }), item({ workspaceId: 'b' })];
    expect(
      bulkTransferFraction(items, 'a', {
        phase: 'building',
        bytesDown: 0,
        bytesUp: 0,
        chunksDone: 0,
      }),
    ).toBe(0);
    expect(
      bulkTransferFraction(items, 'a', {
        phase: 'relaying',
        bytesDown: 50,
        bytesUp: 0,
        chunksDone: 0,
      }),
    ).toBe(0);
  });

  it('counts a committing workspace as fully relayed', () => {
    const items = [item({ workspaceId: 'a', status: 'running' }), item({ workspaceId: 'b' })];
    expect(
      bulkTransferFraction(items, 'a', {
        phase: 'committing',
        bytesTotal: 10,
        bytesDown: 10,
        bytesUp: 10,
        chunksDone: 1,
      }),
    ).toBe(0.5);
  });

  it('gives unknown sizes the average known weight and empty workspaces a minimum weight', () => {
    const unknown = [
      item({ workspaceId: 'a', sizeBytes: 200, status: 'done' }),
      item({ workspaceId: 'b', sizeStatus: 'error', sizeBytes: null }),
    ];
    expect(bulkTransferFraction(unknown, null, null)).toBe(0.5);

    const empty = [
      item({ workspaceId: 'a', sizeBytes: 0, status: 'done' }),
      item({ workspaceId: 'b', sizeBytes: 0 }),
    ];
    expect(bulkTransferFraction(empty, null, null)).toBe(0.5);
  });

  it('never exceeds one when the archive outgrows its estimate', () => {
    const items = [item({ workspaceId: 'a', status: 'running' })];
    expect(
      bulkTransferFraction(items, 'a', {
        phase: 'relaying',
        bytesTotal: 10,
        bytesDown: 40,
        bytesUp: 40,
        chunksDone: 1,
      }),
    ).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createProgressTransferLabel,
  parseCreateProgressTransfer,
} from '../create-progress-transfer';

const MB = 1_000_000;

describe('parseCreateProgressTransfer', () => {
  it('accepts the full daemon shape', () => {
    expect(
      parseCreateProgressTransfer({
        receivedObjects: 10,
        totalObjects: 20,
        receivedBytes: 2048,
        bytesPerSecond: 512,
      }),
    ).toEqual({ receivedObjects: 10, totalObjects: 20, receivedBytes: 2048, bytesPerSecond: 512 });
  });

  it('accepts counts without byte fields (before git prints its throughput)', () => {
    expect(parseCreateProgressTransfer({ receivedObjects: 1, totalObjects: 20 })).toEqual({
      receivedObjects: 1,
      totalObjects: 20,
    });
  });

  it('drops malformed byte fields but keeps valid counts', () => {
    expect(
      parseCreateProgressTransfer({
        receivedObjects: 1,
        totalObjects: 20,
        receivedBytes: '12 MiB',
        bytesPerSecond: -1,
      }),
    ).toEqual({ receivedObjects: 1, totalObjects: 20 });
  });

  it.each([
    ['missing', undefined],
    ['not an object', 'transfer'],
    ['missing total', { receivedObjects: 1 }],
    ['zero total', { receivedObjects: 0, totalObjects: 0 }],
    ['negative count', { receivedObjects: -1, totalObjects: 20 }],
    ['non-finite count', { receivedObjects: Number.NaN, totalObjects: 20 }],
  ])('rejects %s', (_name, raw) => {
    expect(parseCreateProgressTransfer(raw)).toBeUndefined();
  });
});

describe('createProgressTransferLabel', () => {
  it('is null until git reports bytes', () => {
    expect(createProgressTransferLabel({ receivedObjects: 1, totalObjects: 20 })).toBeNull();
  });

  it('shows size and rate', () => {
    expect(
      createProgressTransferLabel({
        receivedObjects: 1,
        totalObjects: 1000,
        receivedBytes: 12_300_000,
        bytesPerSecond: 5_700_000,
      }),
    ).toBe('12.3 MB · 5.7 MB/s');
  });

  it('never adds a time left, even late in the download', () => {
    expect(
      createProgressTransferLabel({
        receivedObjects: 900,
        totalObjects: 1000,
        receivedBytes: 120 * MB,
        bytesPerSecond: MB,
      }),
    ).toBe('120 MB · 1 MB/s');
  });

  it('switches to kB and GB at the edges', () => {
    expect(
      createProgressTransferLabel({
        receivedObjects: 1,
        totalObjects: 1000,
        receivedBytes: 512_000,
        bytesPerSecond: 64_000,
      }),
    ).toBe('512 kB · 64 kB/s');
    expect(
      createProgressTransferLabel({
        receivedObjects: 1,
        totalObjects: 1000,
        receivedBytes: 2_340_000_000,
        bytesPerSecond: 12_000_000,
      }),
    ).toBe('2.34 GB · 12 MB/s');
  });

  it('keeps one decimal under 10 kB so a slow download does not read as a stall', () => {
    expect(
      createProgressTransferLabel({
        receivedObjects: 1,
        totalObjects: 1000,
        receivedBytes: 512_000,
        bytesPerSecond: 300,
      }),
    ).toBe('512 kB · 0.3 kB/s');
  });
});

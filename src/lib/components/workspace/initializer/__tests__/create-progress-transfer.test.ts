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

describe('createProgressTransferLabel time left', () => {
  it('projects the remaining objects at the average object size so far', () => {
    // 25% of objects in 10 MB → about 30 MB left at 5 MB/s → 6 s → "5s".
    expect(
      createProgressTransferLabel({
        receivedObjects: 250,
        totalObjects: 1000,
        receivedBytes: 10 * MB,
        bytesPerSecond: 5 * MB,
      }),
    ).toBe('10 MB · 5 MB/s · 5s left');
  });

  it.each([
    [
      'a stalled rate',
      { receivedObjects: 500, totalObjects: 1000, receivedBytes: MB, bytesPerSecond: 0 },
      '1 MB · 0 kB/s',
    ],
    [
      'too few objects to extrapolate',
      { receivedObjects: 10, totalObjects: 1000, receivedBytes: MB, bytesPerSecond: MB },
      '1 MB · 1 MB/s',
    ],
    [
      'a finished download',
      { receivedObjects: 1000, totalObjects: 1000, receivedBytes: MB, bytesPerSecond: MB },
      '1 MB · 1 MB/s',
    ],
  ])('omits it with %s', (_name, transfer, label) => {
    expect(createProgressTransferLabel(transfer)).toBe(label);
  });
});

describe('createProgressTransferLabel', () => {
  it('is null until git reports bytes', () => {
    expect(createProgressTransferLabel({ receivedObjects: 1, totalObjects: 20 })).toBeNull();
  });

  it('shows size and rate without a time when the estimate is not ready', () => {
    expect(
      createProgressTransferLabel({
        receivedObjects: 1,
        totalObjects: 1000,
        receivedBytes: 12_300_000,
        bytesPerSecond: 5_700_000,
      }),
    ).toBe('12.3 MB · 5.7 MB/s');
  });

  it('adds a rounded time left once the estimate is ready', () => {
    // 50% in 120 MB → 120 MB left at 1 MB/s → 120 s → "2m".
    expect(
      createProgressTransferLabel({
        receivedObjects: 500,
        totalObjects: 1000,
        receivedBytes: 120 * MB,
        bytesPerSecond: MB,
      }),
    ).toBe('120 MB · 1 MB/s · 2m left');
    // Under a minute rounds to 5 s steps: 13 s → "15s".
    expect(
      createProgressTransferLabel({
        receivedObjects: 500,
        totalObjects: 1000,
        receivedBytes: 13 * MB,
        bytesPerSecond: MB,
      }),
    ).toBe('13 MB · 1 MB/s · 15s left');
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

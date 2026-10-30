/**
 * First-seen estimate for installs that predate the install-age telemetry:
 * the userData folder's creation time, falling back to its oldest entry's
 * mtime (birthtime is 0 or missing on some Linux filesystems).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { estimateDirCreatedAtMs, type DirAgeFs } from './user-data-age';

function fakeFs(
  dir: { birthtimeMs: number } | Error,
  entries: Record<string, number | Error> | Error,
): DirAgeFs {
  return {
    stat: async () => {
      if (dir instanceof Error) throw dir;
      return dir;
    },
    readdir: async () => {
      if (entries instanceof Error) throw entries;
      return Object.keys(entries);
    },
    lstat: async (p: string) => {
      const value = (entries as Record<string, number | Error>)[path.basename(p)];
      if (value instanceof Error) throw value;
      return { mtimeMs: value };
    },
  };
}

describe('estimateDirCreatedAtMs', () => {
  it('uses the folder birthtime when the filesystem reports one', async () => {
    const result = await estimateDirCreatedAtMs('/u', fakeFs({ birthtimeMs: 1_000 }, { a: 500 }));
    expect(result).toBe(1_000);
  });

  it('falls back to the oldest entry mtime when birthtime is 0', async () => {
    const result = await estimateDirCreatedAtMs(
      '/u',
      fakeFs({ birthtimeMs: 0 }, { a: 3_000, b: 2_000, c: 9_000 }),
    );
    expect(result).toBe(2_000);
  });

  it('skips entries that cannot be stat-ed or carry no mtime', async () => {
    const result = await estimateDirCreatedAtMs(
      '/u',
      fakeFs({ birthtimeMs: Number.NaN }, { gone: new Error('ENOENT'), zero: 0, ok: 7_000 }),
    );
    expect(result).toBe(7_000);
  });

  it('is null when neither birthtime nor any mtime is available', async () => {
    expect(await estimateDirCreatedAtMs('/u', fakeFs({ birthtimeMs: 0 }, {}))).toBeNull();
    expect(
      await estimateDirCreatedAtMs('/u', fakeFs({ birthtimeMs: 0 }, new Error('EACCES'))),
    ).toBeNull();
    expect(await estimateDirCreatedAtMs('/u', fakeFs(new Error('ENOENT'), {}))).toBeNull();
  });

  describe('on the real filesystem', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-data-age-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns a plausible timestamp for a just-created folder', async () => {
      const old = new Date('2024-02-03T04:05:06Z');
      await fs.writeFile(path.join(dir, 'old.json'), '{}');
      await fs.utimes(path.join(dir, 'old.json'), old, old);
      const result = await estimateDirCreatedAtMs(dir);
      expect(result).not.toBeNull();
      // Either the real birthtime (now) or, where birthtime is 0, the oldest mtime.
      // Filesystem timestamps come from the real clock, so compare against it rather
      // than `Date.now()`, which the nightly shifted-clock run moves (VITEST_SHIFTED_NOW).
      const realNow = vi.getRealSystemTime();
      expect(result === old.getTime() || Math.abs((result as number) - realNow) < 60_000).toBe(
        true,
      );
    });
  });
});

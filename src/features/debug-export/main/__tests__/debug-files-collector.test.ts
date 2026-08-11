/**
 * Tests for the intentd daemon-log + sidecar-run-log sections of the debug
 * bundle collector: bounded log tails from the daemon data dir, the last
 * sidecar run record, and export-manifest omissions when either is absent.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sidecarMock = vi.hoisted(() => ({
  runLog: {
    available: false,
    startedAt: null as string | null,
    endedAt: null as string | null,
    exitCode: null as number | null,
    signal: null as string | null,
    spawnError: null as string | null,
    lines: [] as string[],
  },
}));

vi.mock('../../../backend/main/intentd-sidecar', () => ({
  getSidecarRunLog: () => sidecarMock.runLog,
}));

import {
  collectDebugFiles,
  copyDebugFile,
  INTENTD_LOG_FILE_COUNT,
  INTENTD_LOG_TAIL_BYTES,
  resolveIntentdDataDir,
} from '../debug-files-collector';

let dataDir: string;
const ORIGINAL_DATA_DIR = process.env.INTENTD_DATA_DIR;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'debug-collector-test-'));
  process.env.INTENTD_DATA_DIR = dataDir;
  sidecarMock.runLog = { ...sidecarMock.runLog, available: false, lines: [] };
});

afterEach(async () => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.INTENTD_DATA_DIR;
  else process.env.INTENTD_DATA_DIR = ORIGINAL_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('intentd daemon log collection', () => {
  it('includes the newest rotated log files, tail-capped, under intentd/', async () => {
    const names = ['intentd.2026-08-09.log', 'intentd.2026-08-10.log', 'intentd.2026-08-11.log'];
    for (const [i, name] of names.entries()) {
      const filePath = path.join(dataDir, name);
      await fs.writeFile(filePath, `log ${name}\n`);
      const mtime = new Date(Date.now() - (names.length - i) * 60_000);
      await fs.utimes(filePath, mtime, mtime);
    }
    // Non-matching files in the data dir are never picked up
    await fs.writeFile(path.join(dataDir, 'intentd.db'), 'not a log');

    const { files, omissions } = await collectDebugFiles();
    const intentdLogs = files.filter((f) => f.relativePath.startsWith('intentd' + path.sep));
    expect(intentdLogs.map((f) => f.relativePath).sort()).toEqual([
      path.join('intentd', 'intentd.2026-08-10.log'),
      path.join('intentd', 'intentd.2026-08-11.log'),
    ]);
    expect(intentdLogs).toHaveLength(INTENTD_LOG_FILE_COUNT);
    for (const log of intentdLogs) {
      expect(log.tailBytes).toBe(INTENTD_LOG_TAIL_BYTES);
    }
    expect(omissions.some((o) => o.startsWith('intentd/:'))).toBe(false);
  });

  it('records an omission when the data dir has no intentd log files', async () => {
    const { files, omissions } = await collectDebugFiles();
    expect(files.some((f) => f.relativePath.startsWith('intentd' + path.sep))).toBe(false);
    expect(omissions).toContainEqual(
      `intentd/: skipped — no intentd daemon log files found in "${dataDir}"`,
    );
  });

  it('records an omission when the data dir does not exist', async () => {
    const missing = path.join(dataDir, 'nope');
    process.env.INTENTD_DATA_DIR = missing;
    const { omissions } = await collectDebugFiles();
    expect(omissions).toContainEqual(
      `intentd/: skipped — intentd data dir not accessible at "${missing}"`,
    );
  });
});

describe('sidecar run log collection', () => {
  it('includes the last run record as a content entry when available', async () => {
    sidecarMock.runLog = {
      available: true,
      startedAt: '2026-08-11T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      signal: null,
      spawnError: null,
      lines: ['hello', 'world'],
    };
    const { files, omissions } = await collectDebugFiles();
    const entry = files.find(
      (f) => f.relativePath === path.join('intentd', 'sidecar-run-log.json'),
    );
    expect(entry).toBeDefined();
    expect(entry!.sourcePath).toBeUndefined();
    expect(JSON.parse(entry!.content!)).toEqual(sidecarMock.runLog);
    expect(omissions.some((o) => o.startsWith('intentd/sidecar-run-log.json'))).toBe(false);
  });

  it('records an omission when no sidecar run was captured', async () => {
    const { files, omissions } = await collectDebugFiles();
    expect(files.some((f) => f.relativePath.endsWith('sidecar-run-log.json'))).toBe(false);
    expect(
      omissions.some((o) => o.startsWith('intentd/sidecar-run-log.json: skipped')),
    ).toBe(true);
  });
});

describe('copyDebugFile', () => {
  it('writes literal content entries', async () => {
    const dest = path.join(dataDir, 'out.json');
    await copyDebugFile({ relativePath: 'out.json', content: '{"a":1}' }, dest);
    await expect(fs.readFile(dest, 'utf8')).resolves.toBe('{"a":1}');
  });

  it('copies files under the tail cap verbatim', async () => {
    const src = path.join(dataDir, 'small.log');
    const dest = path.join(dataDir, 'small.out');
    await fs.writeFile(src, 'short log\n');
    await copyDebugFile({ sourcePath: src, relativePath: 'x', tailBytes: 1024 }, dest);
    await expect(fs.readFile(dest, 'utf8')).resolves.toBe('short log\n');
  });

  it('writes only the trailing bytes with a truncation marker when over the cap', async () => {
    const src = path.join(dataDir, 'big.log');
    const dest = path.join(dataDir, 'big.out');
    await fs.writeFile(src, 'AAAAABBBBBCCCCC'); // 15 bytes
    await copyDebugFile({ sourcePath: src, relativePath: 'x', tailBytes: 5 }, dest);
    const out = await fs.readFile(dest, 'utf8');
    expect(out).toBe('[truncated: last 5 of 15 bytes]\nCCCCC');
  });
});


describe('resolveIntentdDataDir', () => {
  it('honors INTENTD_DATA_DIR', () => {
    expect(resolveIntentdDataDir({ INTENTD_DATA_DIR: '/custom/data ' }, 'darwin')).toBe(
      '/custom/data',
    );
  });

  it('defaults to ~/Library/Application Support/intentd on darwin', () => {
    expect(resolveIntentdDataDir({}, 'darwin')).toBe(
      path.join(os.homedir(), 'Library', 'Application Support', 'intentd'),
    );
  });

  it('defaults to %APPDATA%\\intentd\\data on win32', () => {
    expect(resolveIntentdDataDir({ APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' }, 'win32')).toBe(
      'C:\\Users\\alice\\AppData\\Roaming\\intentd\\data',
    );
  });

  it('honors XDG_DATA_HOME on linux with a ~/.local/share fallback', () => {
    expect(resolveIntentdDataDir({ XDG_DATA_HOME: '/xdg/data' }, 'linux')).toBe(
      path.join('/xdg/data', 'intentd'),
    );
    expect(resolveIntentdDataDir({}, 'linux')).toBe(
      path.join(os.homedir(), '.local', 'share', 'intentd'),
    );
  });
});

/**
 * Tests for the intentd daemon-log + sidecar-run-log sections of the debug
 * bundle collector: bounded log tails from the daemon data dir, the last
 * sidecar run record, and export-manifest omissions when either is absent.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
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

const memoryMock = vi.hoisted(() => ({
  /** Snapshot the stubbed capture returns, or `null` to simulate a failed sample. */
  snapshot: null as MemorySnapshot | null,
}));

// Only the capture is stubbed: retention, peaks and the history shape are the
// real implementation, so these tests cover the file the collector emits.
vi.mock('../../../../main/memory-monitor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../main/memory-monitor')>();
  return {
    ...actual,
    logMemorySample: async () => {
      if (!memoryMock.snapshot) return null;
      actual.recordMemorySample(memoryMock.snapshot);
      return memoryMock.snapshot;
    },
  };
});

import {
  __resetMemoryHistoryForTesting,
  type MemorySnapshot,
  type ProcessMemorySample,
} from '../../../../main/memory-monitor';
import {
  collectDebugFiles,
  copyDebugFile,
  INTENTD_LOG_FILE_COUNT,
  INTENTD_LOG_TAIL_BYTES,
  MEMORY_METRICS_SCHEMA_VERSION,
  resolveIntentdDataDir,
} from '../debug-files-collector';

let dataDir: string;
const ORIGINAL_DATA_DIR = process.env.INTENTD_DATA_DIR;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'debug-collector-test-'));
  process.env.INTENTD_DATA_DIR = dataDir;
  sidecarMock.runLog = { ...sidecarMock.runLog, available: false, lines: [] };
  memoryMock.snapshot = null;
  __resetMemoryHistoryForTesting();
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

  it('keeps the surviving logs when a file vanishes between readdir and stat (rotation race)', async () => {
    const kept = path.join(dataDir, 'intentd.2026-08-11.log');
    const vanishing = path.join(dataDir, 'intentd.2026-08-10.log');
    await fs.writeFile(kept, 'kept\n');
    await fs.writeFile(vanishing, 'vanishing\n');
    const realStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (p, ...rest) => {
      if (p === vanishing) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return realStat(p as Parameters<typeof realStat>[0], ...(rest as []));
    });
    try {
      const { files, omissions } = await collectDebugFiles();
      const intentdLogs = files.filter((f) => f.relativePath.startsWith('intentd' + path.sep));
      expect(intentdLogs.map((f) => f.relativePath)).toEqual([
        path.join('intentd', 'intentd.2026-08-11.log'),
      ]);
      expect(omissions.some((o) => o.startsWith('intentd/:'))).toBe(false);
    } finally {
      statSpy.mockRestore();
    }
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

describe('renderer lifecycle telemetry export', () => {
  it('includes persisted late-session lifecycle records from renderer.log', async () => {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    const rendererLog = path.join(logsDir, 'renderer.log');
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(
      rendererLog,
      '{"message":"stream-lifecycle","event":"agent-failed-received"}\n',
      'utf8',
    );

    try {
      const result = await collectDebugFiles();
      expect(result.files).toContainEqual({
        sourcePath: rendererLog,
        relativePath: path.join('logs', 'renderer.log'),
      });
    } finally {
      await fs.unlink(rendererLog).catch(() => {});
    }
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
    expect(omissions.some((o) => o.startsWith('intentd/sidecar-run-log.json: skipped'))).toBe(true);
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

  it('uses the actual bytes read when the file shrinks between stat and read', async () => {
    const src = path.join(dataDir, 'shrinking.log');
    const dest = path.join(dataDir, 'shrinking.out');
    await fs.writeFile(src, 'AAAAABBBBBCCCCC'); // 15 bytes on disk
    const realStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (p, ...rest) => {
      const stats = await realStat(p as Parameters<typeof realStat>[0], ...(rest as []));
      if (p === src) Object.defineProperty(stats, 'size', { value: 20 });
      return stats;
    });
    try {
      // stat reports 20 bytes → read starts at offset 10 but only 5 remain
      await copyDebugFile({ sourcePath: src, relativePath: 'x', tailBytes: 10 }, dest);
      const out = await fs.readFile(dest, 'utf8');
      expect(out).toBe('[truncated: last 5 of 20 bytes]\nCCCCC');
      expect(out).not.toContain('\0');
    } finally {
      statSpy.mockRestore();
    }
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

  it('falls back to ~/AppData/Roaming when APPDATA is unset on win32', () => {
    expect(resolveIntentdDataDir({}, 'win32')).toBe(
      path.win32.join(os.homedir(), 'AppData', 'Roaming', 'intentd', 'data'),
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

  it('ignores a relative XDG_DATA_HOME (XDG spec: non-absolute paths are invalid)', () => {
    expect(resolveIntentdDataDir({ XDG_DATA_HOME: 'relative/path' }, 'linux')).toBe(
      path.join(os.homedir(), '.local', 'share', 'intentd'),
    );
  });
});

describe('memory metrics collection', () => {
  const MB = 1024 * 1024;

  function processSample(
    pid: number,
    kind: ProcessMemorySample['kind'],
    rssMB: number,
    name?: string,
  ): ProcessMemorySample {
    return { pid, kind, rssBytes: rssMB * MB, ...(name === undefined ? {} : { name }) };
  }

  function snapshotWith(agents: ProcessMemorySample[]): MemorySnapshot {
    return {
      electron: [processSample(1, 'main', 330), processSample(2, 'renderer', 719)],
      sidecar: [processSample(3, 'sidecar', 200, 'intentd')],
      agents,
      processTableUnavailable: false,
    };
  }

  async function collectMemoryMetrics() {
    const { files, omissions, memorySnapshot } = await collectDebugFiles();
    const file = files.find((f) => f.relativePath === 'memory-metrics.json');
    return {
      omissions,
      memorySnapshot,
      metrics: file?.content ? JSON.parse(file.content) : undefined,
    };
  }

  it('writes memory-metrics.json with the retained window and a capture-time snapshot', async () => {
    memoryMock.snapshot = snapshotWith([processSample(90, 'agent', 400, 'claude')]);

    const { metrics, memorySnapshot, omissions } = await collectMemoryMetrics();

    expect(metrics.schemaVersion).toBe(MEMORY_METRICS_SCHEMA_VERSION);
    expect(metrics.samples.length).toBeGreaterThan(0);
    expect(metrics.capturedAt.totalRssBytes).toBe((330 + 719 + 200 + 400) * MB);
    // The capture-time entry keeps every process, not just the largest few
    expect(metrics.capturedAt.processes).toHaveLength(4);
    expect(metrics.capturedAt.byKind.agent).toEqual({ count: 1, rssBytes: 400 * MB });
    expect(metrics.retention).toEqual({ maxSamples: 2000, maxAgeMs: 24 * 60 * 60 * 1000 });
    // Returned to the caller so system-info.json can describe the same processes
    expect(memorySnapshot).toBe(memoryMock.snapshot);
    expect(omissions.some((o) => o.startsWith('memory-metrics.json'))).toBe(false);
  });

  it('reports a peak that has already drained by capture time', async () => {
    const { recordMemorySample } = await import('../../../../main/memory-monitor');
    recordMemorySample(
      snapshotWith([processSample(90, 'agent', 16_000, 'claude')]),
      '2026-08-12T00:00:00.000Z',
    );
    memoryMock.snapshot = snapshotWith([processSample(90, 'agent', 10, 'claude')]);

    const { metrics } = await collectMemoryMetrics();

    expect(metrics.capturedAt.byKind.agent.rssBytes).toBe(10 * MB);
    expect(metrics.peaks.byKind.agent).toEqual({
      rssBytes: 16_000 * MB,
      at: '2026-08-12T00:00:00.000Z',
    });
    expect(metrics.peaks.singleProcess).toMatchObject({
      pid: 90,
      name: 'claude',
      rssBytes: 16_000 * MB,
    });
  });

  it('keeps the retained window when the capture-time sample fails, and records the omission', async () => {
    const { recordMemorySample } = await import('../../../../main/memory-monitor');
    // Pin the clock to the fixture date so the retained sample cannot age out
    // of the prune-on-read window (intent-hq/monorepo#2173).
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
      recordMemorySample(
        snapshotWith([processSample(90, 'agent', 5_000, 'claude')]),
        '2026-08-12T00:00:00.000Z',
      );
      memoryMock.snapshot = null;

      const { metrics, memorySnapshot, omissions } = await collectMemoryMetrics();

      expect(metrics.capturedAt).toBeNull();
      expect(metrics.samples).toHaveLength(1);
      expect(metrics.peaks.total.rssBytes).toBe((330 + 719 + 200 + 5_000) * MB);
      expect(memorySnapshot).toBeNull();
      expect(
        omissions.some((o) =>
          o.startsWith('memory-metrics.json: capture-time snapshot unavailable'),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reports peaks when every retained sample has aged out', async () => {
    const { recordMemorySample } = await import('../../../../main/memory-monitor');
    vi.useFakeTimers();
    try {
      recordMemorySample(
        snapshotWith([processSample(90, 'agent', 16_000, 'claude')]),
        '2026-08-12T00:00:00.000Z',
      );
      // Suspended well past the retention window, and the capture also fails
      vi.setSystemTime(new Date(Date.parse('2026-08-12T00:00:00.000Z') + 48 * 60 * 60 * 1000));
      memoryMock.snapshot = null;

      const { metrics, omissions } = await collectMemoryMetrics();

      expect(metrics.samples).toEqual([]);
      expect(metrics.capturedAt).toBeNull();
      // The whole point of the file survives an expired timeline
      expect(metrics.peaks.singleProcess).toMatchObject({ pid: 90, rssBytes: 16_000 * MB });
      expect(
        omissions.some((o) => o.startsWith('memory-metrics.json: retained timeline is empty')),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits the file entirely when nothing was ever sampled', async () => {
    memoryMock.snapshot = null;

    const { metrics, omissions } = await collectMemoryMetrics();

    expect(metrics).toBeUndefined();
    expect(omissions).toContainEqual(
      'memory-metrics.json: skipped — no memory samples retained (sampler never ran and the capture-time sample failed)',
    );
  });
});

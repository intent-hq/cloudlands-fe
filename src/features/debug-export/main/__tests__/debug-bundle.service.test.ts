/**
 * End-to-end check of the files a debug bundle is assembled from.
 *
 * Only the zip step is stubbed (yazl's output is not readable without adding an
 * unzip dependency); it captures the staging directory instead, which is
 * byte-for-byte what the archive would contain.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';

const zipMock = vi.hoisted(() => ({
  /** Relative path → file contents, captured before the staging dir is cleaned up. */
  entries: new Map<string, string>(),
}));

vi.mock('../zip-utils', () => ({
  createZipFromPaths: async (sourceDir: string) => {
    zipMock.entries.clear();
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(full, rel);
        else if (entry.isFile()) zipMock.entries.set(rel, await fs.readFile(full, 'utf8'));
      }
    };
    await walk(sourceDir, '');
  },
}));

const memoryMock = vi.hoisted(() => ({ snapshot: null as MemorySnapshot | null }));

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
} from '../../../../main/memory-monitor';
import { createDebugBundle } from '../debug-bundle.service';

const MB = 1024 * 1024;

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'debug-bundle-test-'));
  vi.mocked(app.getPath).mockImplementation((name: string) =>
    name === 'temp' ? tempRoot : path.join(tempRoot, name),
  );
  zipMock.entries.clear();
  __resetMemoryHistoryForTesting();
  memoryMock.snapshot = {
    electron: [
      { pid: 1, kind: 'main', rssBytes: 330 * MB },
      { pid: 2, kind: 'renderer', rssBytes: 719 * MB },
    ],
    sidecar: [{ pid: 3, kind: 'sidecar', name: 'intentd', rssBytes: 200 * MB }],
    agents: [{ pid: 90, kind: 'agent', name: 'claude', rssBytes: 1_200 * MB }],
    processTableUnavailable: false,
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createDebugBundle', () => {
  it('includes memory-metrics.json and process detail in system-info.json', async () => {
    const { recordMemorySample } = await import('../../../../main/memory-monitor');
    // A spike that has fully drained by the time the bundle is created
    recordMemorySample(
      {
        electron: [],
        sidecar: [],
        agents: [{ pid: 90, kind: 'agent', name: 'claude', rssBytes: 16_000 * MB }],
        processTableUnavailable: false,
      },
      '2026-08-12T00:00:00.000Z',
    );

    await createDebugBundle();

    const metrics = JSON.parse(zipMock.entries.get('memory-metrics.json') as string);
    expect(metrics.samples.length).toBeGreaterThan(0);
    expect(metrics.capturedAt.totalRssBytes).toBe((330 + 719 + 200 + 1_200) * MB);
    // The drained spike is still recoverable from the bundle
    expect(metrics.peaks.singleProcess).toMatchObject({ pid: 90, rssBytes: 16_000 * MB });

    const systemInfo = JSON.parse(zipMock.entries.get('system-info.json') as string);
    expect(systemInfo.processes).toHaveLength(4);
    expect(systemInfo.processes).toContainEqual({
      pid: 90,
      type: 'agent',
      rss: 1_200 * MB,
      name: 'claude',
    });
    // Pre-existing fields are untouched
    expect(systemInfo.appVersion).toBe('1.0.0');
    expect(systemInfo.memory.totalMemory).toBeGreaterThan(0);
  });

  it('still produces a bundle, with the omission recorded, when nothing was sampled', async () => {
    memoryMock.snapshot = null;

    await createDebugBundle();

    expect(zipMock.entries.has('memory-metrics.json')).toBe(false);
    expect(JSON.parse(zipMock.entries.get('system-info.json') as string).processes).toEqual([]);
    const manifest = JSON.parse(zipMock.entries.get('export-manifest.json') as string);
    expect(
      manifest.omissions.some((o: string) => o.startsWith('memory-metrics.json: skipped')),
    ).toBe(true);
  });
});

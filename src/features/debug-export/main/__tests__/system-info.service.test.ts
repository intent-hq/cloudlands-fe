/**
 * Tests for the `processes` section of `system-info.json`: it describes the
 * capture-time memory reading, and stays back-compatible (existing fields
 * unchanged, empty array) when no reading is available.
 */
import { describe, expect, it } from 'vitest';

import type { MemorySnapshot } from '../../../../main/memory-monitor';
import { generateSystemInfo } from '../system-info.service';

const MB = 1024 * 1024;

const snapshot: MemorySnapshot = {
  electron: [
    { pid: 1, kind: 'main', rssBytes: 330 * MB },
    { pid: 2, kind: 'renderer', rssBytes: 719 * MB },
  ],
  sidecar: [{ pid: 3, kind: 'sidecar', name: 'intentd', rssBytes: 200 * MB }],
  agents: [{ pid: 90, kind: 'agent', name: 'claude', rssBytes: 1_200 * MB }],
  processTableUnavailable: false,
};

describe('generateSystemInfo', () => {
  it('describes every sampled process as pid/type/rss', () => {
    const info = generateSystemInfo(snapshot);

    expect(info.processes).toEqual([
      { pid: 1, type: 'main', rss: 330 * MB },
      { pid: 2, type: 'renderer', rss: 719 * MB },
      { pid: 3, type: 'sidecar', rss: 200 * MB, name: 'intentd' },
      { pid: 90, type: 'agent', rss: 1_200 * MB, name: 'claude' },
    ]);
  });

  it('emits an empty processes array when no reading is available', () => {
    expect(generateSystemInfo(null).processes).toEqual([]);
    expect(generateSystemInfo().processes).toEqual([]);
  });

  it('leaves the pre-existing fields untouched', () => {
    const info = generateSystemInfo(snapshot);

    expect(info.appVersion).toBe('1.0.0');
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.nodeVersion).toBe(process.versions.node);
    expect(info.memory.usedMemory).toBe(info.memory.totalMemory - info.memory.freeMemory);
    expect(info.cpuCount).toBeGreaterThan(0);
    expect(() => new Date(info.timestamp).toISOString()).not.toThrow();
  });

  it('reports the frontend build commit when available and omits it otherwise', () => {
    expect(generateSystemInfo(snapshot, '0123456789abcdef').appBuildCommit).toBe(
      '0123456789abcdef',
    );
    expect(generateSystemInfo(snapshot, '')).not.toHaveProperty('appBuildCommit');
  });
});

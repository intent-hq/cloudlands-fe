import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppMetrics: () => [] },
}));

import {
  __isMemoryMonitorRunningForTesting,
  allSamples,
  collectDescendants,
  DEFAULT_WARN_THRESHOLD_BYTES,
  findSidecarProcesses,
  findThresholdBreaches,
  FIRST_SAMPLE_DELAY_MS,
  formatSnapshot,
  formatThresholdWarning,
  logMemorySample,
  parseProcessTable,
  processBasename,
  resolveWarnThresholdBytes,
  SAMPLE_INTERVAL_MS,
  sampleMemory,
  shortProcessName,
  startMemoryMonitor,
  stopMemoryMonitor,
  totalRssBytes,
  WARN_THRESHOLD_ENV_VAR,
  type AppProcessMetric,
  type MemorySnapshot,
  type MemorySources,
  type ProcessTableEntry,
} from '../memory-monitor';

const MB = 1024 * 1024;
const KB = 1024;

function entry(pid: number, ppid: number, rssKB: number, command: string): ProcessTableEntry {
  return { pid, ppid, rssBytes: rssKB * KB, command };
}

function metric(pid: number, type: string, workingSetKB: number): AppProcessMetric {
  return { pid, type, memory: { workingSetSize: workingSetKB } };
}

async function emptyProcessTable(): Promise<ProcessTableEntry[]> {
  return [];
}

function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    electron: [],
    sidecar: [],
    agents: [],
    processTableUnavailable: false,
    ...overrides,
  };
}

describe('parseProcessTable', () => {
  it('parses pid/ppid/rss rows and converts RSS from KB to bytes', () => {
    const rows = parseProcessTable(['  100     1  204800 /usr/bin/intentd', '101 100 1024 node'].join('\n'));

    expect(rows).toEqual([
      { pid: 100, ppid: 1, rssBytes: 204800 * KB, command: '/usr/bin/intentd' },
      { pid: 101, ppid: 100, rssBytes: 1024 * KB, command: 'node' },
    ]);
  });

  it('keeps executable paths that contain spaces intact', () => {
    const rows = parseProcessTable('42 1 512 /Applications/My App.app/Contents/MacOS/My App\n');

    expect(rows[0].command).toBe('/Applications/My App.app/Contents/MacOS/My App');
  });

  it('skips blank, header and malformed rows instead of throwing', () => {
    const rows = parseProcessTable('\nPID PPID RSS COMM\n7 1 100 ok\nnot-a-row\n9 2 3\n');

    expect(rows.map((row) => row.pid)).toEqual([7]);
  });
});

describe('processBasename', () => {
  it('strips directories, .exe suffixes and case', () => {
    expect(processBasename('/opt/intent/intentd')).toBe('intentd');
    expect(processBasename('C:\\Program Files\\Intent\\Intentd.exe')).toBe('intentd');
    expect(processBasename('node')).toBe('node');
  });
});

describe('shortProcessName', () => {
  it('keeps the label whitespace-free and bounded so the sample line stays parseable', () => {
    expect(shortProcessName('/Applications/My App.app/Contents/MacOS/My App')).toBe('my_app');
    expect(shortProcessName('/a/b/a-very-long-provider-binary-name-indeed')).toBe(
      'a-very-long-provider-bin~',
    );
  });
});

describe('findSidecarProcesses', () => {
  it('finds every intentd daemon, including one this app did not spawn', () => {
    const table = [
      entry(1, 0, 100, '/sbin/launchd'),
      entry(100, 1, 200, '/Applications/Intent.app/Contents/Resources/intentd/intentd'),
      entry(300, 1, 300, '/Users/dev/monorepo/packages/intentd/target/debug/intentd'),
      entry(400, 1, 400, '/usr/bin/intentd-helper'),
    ];

    expect(findSidecarProcesses(table).map((row) => row.pid)).toEqual([100, 300]);
  });

  // Real macOS tree: Intent → intentd serve → npm → node → claude → intentd mcp-bridge.
  // The bridge re-execs the daemon binary, so a basename-only match would both
  // mislabel it as a sidecar and count it twice.
  it('does not mistake an "intentd mcp-bridge" agent child for the daemon', () => {
    const table = [
      entry(27861, 1, 400 * 1024, '/Applications/Intent.app/Contents/MacOS/Intent'),
      entry(27864, 27861, 200 * 1024, '/Applications/Intent.app/Contents/Resources/intentd/intentd'),
      entry(53253, 27864, 50 * 1024, 'node'),
      entry(53315, 53253, 460 * 1024, '/opt/claude-agent-sdk/claude'),
      entry(53345, 53315, 15 * 1024, '/Applications/Intent.app/Contents/Resources/intentd/intentd'),
    ];

    expect(findSidecarProcesses(table).map((row) => row.pid)).toEqual([27864]);
    expect(collectDescendants(table, [27864]).map((row) => row.pid)).toEqual([53253, 53315, 53345]);
  });
});

describe('collectDescendants', () => {
  it('walks the full descendant tree, not just direct children', () => {
    const table = [
      entry(100, 1, 200, 'intentd'),
      entry(200, 100, 900, 'claude'),
      entry(300, 200, 50, 'rg'),
      entry(400, 1, 10, 'unrelated'),
    ];

    expect(collectDescendants(table, [100]).map((row) => row.pid)).toEqual([200, 300]);
  });

  it('terminates on a ppid cycle', () => {
    const table = [entry(10, 11, 1, 'a'), entry(11, 10, 1, 'b')];

    expect(collectDescendants(table, [10]).map((row) => row.pid)).toEqual([11]);
  });
});

describe('sampleMemory', () => {
  const sources: MemorySources = {
    appMetrics: () => [
      metric(1, 'Browser', 999),
      metric(2, 'Tab', 900 * 1024),
      metric(3, 'GPU', 180 * 1024),
    ],
    mainRssBytes: () => 400 * MB,
    processTable: async () => [
      entry(100, 1, 500 * 1024, '/opt/intentd'),
      entry(200, 100, 1200 * 1024, '/usr/local/bin/claude'),
      entry(300, 200, 100 * 1024, 'rg'),
      entry(999, 1, 8 * 1024 * 1024, 'chrome'),
    ],
  };

  it('classifies Electron processes and prefers process.memoryUsage() for main', async () => {
    const result = await sampleMemory(sources);

    expect(result.electron).toEqual([
      { pid: 1, kind: 'main', name: undefined, rssBytes: 400 * MB },
      { pid: 2, kind: 'renderer', name: undefined, rssBytes: 900 * MB },
      { pid: 3, kind: 'gpu', name: undefined, rssBytes: 180 * MB },
    ]);
  });

  it('reports the sidecar and its whole descendant tree, ignoring unrelated processes', async () => {
    const result = await sampleMemory(sources);

    expect(result.sidecar.map((s) => s.pid)).toEqual([100]);
    expect(result.agents.map((s) => ({ pid: s.pid, name: s.name }))).toEqual([
      { pid: 200, name: 'claude' },
      { pid: 300, name: 'rg' },
    ]);
    expect(result.processTableUnavailable).toBe(false);
  });

  it('counts agent children in the aggregate total', async () => {
    const result = await sampleMemory(sources);

    // 400 (main) + 900 (renderer) + 180 (gpu) + 500 (intentd) + 1200 + 100 (agents)
    expect(totalRssBytes(result)).toBe(3280 * MB);
    expect(allSamples(result)).toHaveLength(6);
  });

  it('marks the tree unknown (not empty) when the process table cannot be read', async () => {
    const result = await sampleMemory({ ...sources, processTable: async () => null });

    expect(result.processTableUnavailable).toBe(true);
    expect(result.sidecar).toEqual([]);
    expect(result.agents).toEqual([]);
    expect(formatSnapshot(result)).toContain('sidecar(intentd)=unknown');
    expect(formatSnapshot(result)).toContain('agents=unknown');
  });

  // The process tree is the dominant term, so a sum without it must never be
  // presented as Intent's aggregate total.
  it('reports the total as unknown when the process tree is missing', async () => {
    const line = formatSnapshot(await sampleMemory({ ...sources, processTable: async () => null }));

    expect(line).toContain('total=unknown');
    expect(line).toContain('electron-total=1480MB');
    // No bare `total=<n>MB` token a log scraper could mistake for the real one.
    expect(line).not.toMatch(/(^|\s)total=\d+MB/);
  });
});

describe('formatSnapshot', () => {
  it('emits one compact line naming main, renderers, gpu, sidecar, agents and the total', () => {
    const line = formatSnapshot(
      snapshot({
        electron: [
          { pid: 1, kind: 'main', rssBytes: 412 * MB },
          { pid: 2, kind: 'renderer', rssBytes: 980 * MB },
          { pid: 3, kind: 'gpu', rssBytes: 180 * MB },
          { pid: 4, kind: 'utility', rssBytes: 32 * MB },
          { pid: 5, kind: 'utility', rssBytes: 32 * MB },
        ],
        sidecar: [{ pid: 1300, kind: 'sidecar', name: 'intentd', rssBytes: 520 * MB }],
        agents: [
          { pid: 9911, kind: 'agent', name: 'claude', rssBytes: 1200 * MB },
          { pid: 9912, kind: 'agent', name: 'node', rssBytes: 900 * MB },
        ],
      }),
    );

    expect(line).toBe(
      'rss main=412MB renderer[2]=980MB gpu=180MB utility(n=2)=64MB ' +
        'sidecar(intentd)[1300]=520MB agents(n=2)=2100MB ' +
        'top=[claude[9911]=1200MB,node[9912]=900MB] total=4256MB',
    );
  });

  it('lists at most six renderers and aggregates the tail so the line stays bounded', () => {
    const electron = Array.from({ length: 9 }, (_, index) => ({
      pid: 100 + index,
      kind: 'renderer' as const,
      rssBytes: (100 - index) * MB,
    }));

    const line = formatSnapshot(snapshot({ electron }));

    expect(line).toContain('renderer[100]=100MB');
    expect(line).toContain('renderer[105]=95MB');
    expect(line).not.toContain('renderer[106]=');
    expect(line).toContain('renderer(+3 more)=279MB');
  });

  it('says "none" when no daemon is running', () => {
    expect(formatSnapshot(snapshot())).toBe(
      'rss main=0MB sidecar(intentd)=none agents(n=0)=0MB total=0MB',
    );
  });
});

describe('threshold logic', () => {
  const breaching = snapshot({
    electron: [
      { pid: 2, kind: 'renderer', rssBytes: 5 * 1024 * MB },
      { pid: 1, kind: 'main', rssBytes: 400 * MB },
    ],
    agents: [{ pid: 9911, kind: 'agent', name: 'claude', rssBytes: 6 * 1024 * MB }],
  });

  it('reports every breaching process, largest first', () => {
    expect(findThresholdBreaches(breaching, DEFAULT_WARN_THRESHOLD_BYTES).map((s) => s.pid)).toEqual([
      9911, 2,
    ]);
  });

  it('formats a greppable WARN naming the process kind, pid and size', () => {
    expect(formatThresholdWarning(breaching, DEFAULT_WARN_THRESHOLD_BYTES)).toBe(
      'threshold-exceeded threshold=4096MB agent:claude[9911]=6144MB renderer[2]=5120MB',
    );
  });

  it('returns null when nothing crosses the threshold', () => {
    const quiet = snapshot({ electron: [{ pid: 1, kind: 'main', rssBytes: 400 * MB }] });

    expect(formatThresholdWarning(quiet, DEFAULT_WARN_THRESHOLD_BYTES)).toBeNull();
  });

  it('counts an agent child process against the threshold, not just Electron processes', () => {
    const agentsOnly = snapshot({
      agents: [{ pid: 9911, kind: 'agent', name: 'claude', rssBytes: 9 * 1024 * MB }],
    });

    expect(formatThresholdWarning(agentsOnly, DEFAULT_WARN_THRESHOLD_BYTES)).toContain(
      'agent:claude[9911]=9216MB',
    );
  });
});

describe('resolveWarnThresholdBytes', () => {
  it('defaults to 4 GB', () => {
    expect(resolveWarnThresholdBytes({})).toBe(DEFAULT_WARN_THRESHOLD_BYTES);
  });

  it('honours the MB env override', () => {
    expect(resolveWarnThresholdBytes({ [WARN_THRESHOLD_ENV_VAR]: '2048' })).toBe(2048 * MB);
  });

  it('falls back to the default for junk or non-positive values', () => {
    expect(resolveWarnThresholdBytes({ [WARN_THRESHOLD_ENV_VAR]: 'lots' })).toBe(
      DEFAULT_WARN_THRESHOLD_BYTES,
    );
    expect(resolveWarnThresholdBytes({ [WARN_THRESHOLD_ENV_VAR]: '0' })).toBe(
      DEFAULT_WARN_THRESHOLD_BYTES,
    );
  });
});

describe('logMemorySample', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sources: MemorySources = {
    appMetrics: () => [metric(1, 'Browser', 0)],
    mainRssBytes: () => 5 * 1024 * MB,
    processTable: async () => [],
  };

  it('logs an INFO line prefixed with the greppable context', async () => {
    await logMemorySample(sources, DEFAULT_WARN_THRESHOLD_BYTES);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('[INFO] [MemoryMonitor] rss main=5120MB');
  });

  it('adds a WARN line when a process crosses the threshold', async () => {
    await logMemorySample(sources, DEFAULT_WARN_THRESHOLD_BYTES);

    expect(String(warnSpy.mock.calls[0][0])).toContain(
      '[WARN] [MemoryMonitor] threshold-exceeded threshold=4096MB main[1]=5120MB',
    );
  });

  it('never throws when a source fails', async () => {
    const result = await logMemorySample(
      {
        ...sources,
        processTable: async () => {
          throw new Error('ps exploded');
        },
      },
      DEFAULT_WARN_THRESHOLD_BYTES,
    );

    expect(result).toBeNull();
    expect(String(warnSpy.mock.calls[0][0])).toContain('sample failed: ps exploded');
  });
});

describe('start/stop lifecycle', () => {
  afterEach(() => {
    stopMemoryMonitor();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the boot sample ahead of the steady-state interval', () => {
    expect(FIRST_SAMPLE_DELAY_MS).toBeLessThan(SAMPLE_INTERVAL_MS);
  });

  // setInterval alone does not fire until a full interval has elapsed, so a
  // bundle captured in the app's first 60 s would carry no snapshot at all.
  it('takes a boot-window sample well before one full interval has elapsed', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const processTable = vi.fn(emptyProcessTable);
    const sources: MemorySources = {
      appMetrics: () => [metric(1, 'Browser', 0)],
      mainRssBytes: () => 10 * MB,
      processTable,
    };

    startMemoryMonitor({ sources, intervalMs: 60_000, firstSampleMs: 10_000 });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(processTable).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(processTable).toHaveBeenCalledTimes(1);

    // ...and the interval still runs on its own cadence afterwards.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(processTable).toHaveBeenCalledTimes(2);
  });

  it('samples on the interval and stops cleanly with no timer left armed', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const processTable = vi.fn(emptyProcessTable);
    const sources: MemorySources = {
      appMetrics: () => [metric(1, 'Browser', 0)],
      mainRssBytes: () => 10 * MB,
      processTable,
    };

    startMemoryMonitor({
      sources,
      intervalMs: 1000,
      firstSampleMs: 1000,
      thresholdBytes: DEFAULT_WARN_THRESHOLD_BYTES,
    });
    expect(__isMemoryMonitorRunningForTesting()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(processTable).toHaveBeenCalledTimes(2);

    stopMemoryMonitor();
    expect(__isMemoryMonitorRunningForTesting()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(processTable).toHaveBeenCalledTimes(2);
  });

  it('stopping before the boot sample fires leaves nothing armed and never samples', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const processTable = vi.fn(emptyProcessTable);
    const sources: MemorySources = {
      appMetrics: () => [],
      mainRssBytes: () => 0,
      processTable,
    };

    startMemoryMonitor({ sources, intervalMs: 60_000, firstSampleMs: 10_000 });
    expect(__isMemoryMonitorRunningForTesting()).toBe(true);

    stopMemoryMonitor();
    expect(__isMemoryMonitorRunningForTesting()).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(processTable).not.toHaveBeenCalled();
  });

  it('is idempotent — a second start does not arm a second timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const processTable = vi.fn(emptyProcessTable);
    const sources: MemorySources = {
      appMetrics: () => [],
      mainRssBytes: () => 0,
      processTable,
    };

    startMemoryMonitor({ sources, intervalMs: 1000, firstSampleMs: 1000 });
    startMemoryMonitor({ sources, intervalMs: 1000, firstSampleMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(processTable).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while the previous sample is still in flight', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let release: (() => void) | undefined;
    const processTable = vi.fn(
      () =>
        new Promise<ProcessTableEntry[]>((resolve) => {
          release = () => resolve([]);
        }),
    );
    const sources: MemorySources = {
      appMetrics: () => [],
      mainRssBytes: () => 0,
      processTable,
    };

    startMemoryMonitor({ sources, intervalMs: 1000, firstSampleMs: 1000 });

    await vi.advanceTimersByTimeAsync(3000);
    expect(processTable).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(processTable).toHaveBeenCalledTimes(2);
  });
});

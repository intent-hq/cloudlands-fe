import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppMetrics: () => [] },
}));

import {
  __isMemoryMonitorRunningForTesting,
  __resetMemoryHistoryForTesting,
  allSamples,
  collectDescendants,
  DEFAULT_WARN_THRESHOLD_BYTES,
  findSidecarProcesses,
  findThresholdBreaches,
  FIRST_SAMPLE_DELAY_MS,
  formatSnapshot,
  formatThresholdWarning,
  getMemoryHistory,
  logMemorySample,
  MAX_RETAINED_AGE_MS,
  MAX_RETAINED_SAMPLES,
  parseProcessTable,
  processBasename,
  recordMemorySample,
  resolveWarnThresholdBytes,
  RETAINED_TOP_PROCESSES,
  SAMPLE_INTERVAL_MS,
  sampleMemory,
  shortProcessName,
  startMemoryMonitor,
  stopMemoryMonitor,
  summarizeSnapshot,
  totalRssBytes,
  WARN_THRESHOLD_ENV_VAR,
  type AppProcessMetric,
  type MemorySnapshot,
  type MemorySources,
  type ProcessMemorySample,
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
    const rows = parseProcessTable(
      ['  100     1  204800 /usr/bin/intentd', '101 100 1024 node'].join('\n'),
    );

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
      entry(
        27864,
        27861,
        200 * 1024,
        '/Applications/Intent.app/Contents/Resources/intentd/intentd',
      ),
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
    expect(
      findThresholdBreaches(breaching, DEFAULT_WARN_THRESHOLD_BYTES).map((s) => s.pid),
    ).toEqual([9911, 2]);
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

describe('retained history', () => {
  // Fixture timestamps are absolute and getMemoryHistory() prunes on read
  // against the real clock, so pin the clock to the fixture date — otherwise
  // the fixtures age out of the retention window once the wall clock passes
  // them (intent-hq/monorepo#2173).
  beforeEach(() => {
    __resetMemoryHistoryForTesting();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function processSample(
    pid: number,
    kind: ProcessMemorySample['kind'],
    rssMB: number,
    name?: string,
  ): ProcessMemorySample {
    return { pid, kind, rssBytes: rssMB * MB, ...(name === undefined ? {} : { name }) };
  }

  it('summarizes a snapshot into per-kind totals and the largest few processes', () => {
    const summary = summarizeSnapshot(
      snapshot({
        electron: [processSample(1, 'main', 400), processSample(2, 'renderer', 700)],
        sidecar: [processSample(3, 'sidecar', 300, 'intentd')],
        agents: Array.from({ length: 8 }, (_, i) =>
          processSample(100 + i, 'agent', 100 + i, 'claude'),
        ),
      }),
      '2026-08-12T00:00:00.000Z',
    );

    expect(summary.processCount).toBe(11);
    expect(summary.byKind.agent).toEqual({
      count: 8,
      rssBytes: (100 + 101 + 102 + 103 + 104 + 105 + 106 + 107) * MB,
    });
    expect(summary.byKind.main).toEqual({ count: 1, rssBytes: 400 * MB });
    // Only the largest few processes are kept, biggest first
    expect(summary.top).toHaveLength(RETAINED_TOP_PROCESSES);
    expect(summary.top[0]).toMatchObject({ pid: 2, rssBytes: 700 * MB });
    expect(summary.top.map((p) => p.rssBytes)).toEqual(
      [700, 400, 300, 107, 106].map((mb) => mb * MB),
    );
  });

  it('keeps peaks after the overshoot has drained', () => {
    recordMemorySample(
      snapshot({ agents: [processSample(50, 'agent', 200, 'claude')] }),
      '2026-08-12T00:00:00.000Z',
    );
    recordMemorySample(
      snapshot({ agents: [processSample(50, 'agent', 16_000, 'claude')] }),
      '2026-08-12T00:01:00.000Z',
    );
    recordMemorySample(
      snapshot({ agents: [processSample(50, 'agent', 150, 'claude')] }),
      '2026-08-12T00:02:00.000Z',
    );

    const { peaks, samples } = getMemoryHistory();

    // The latest sample is back to normal, but the peak still names the spike
    expect(samples[samples.length - 1].totalRssBytes).toBe(150 * MB);
    expect(peaks.total).toEqual({ rssBytes: 16_000 * MB, at: '2026-08-12T00:01:00.000Z' });
    expect(peaks.byKind.agent).toEqual({ rssBytes: 16_000 * MB, at: '2026-08-12T00:01:00.000Z' });
    expect(peaks.singleProcess).toMatchObject({ pid: 50, name: 'claude', rssBytes: 16_000 * MB });
  });

  it('tracks the peak process count independently of the peak footprint', () => {
    recordMemorySample(
      snapshot({ agents: Array.from({ length: 95 }, (_, i) => processSample(i, 'agent', 1)) }),
      '2026-08-12T00:00:00.000Z',
    );
    recordMemorySample(
      snapshot({ agents: [processSample(1, 'agent', 8_000)] }),
      '2026-08-12T00:01:00.000Z',
    );

    const { peaks } = getMemoryHistory();
    expect(peaks.processCount).toEqual({ count: 95, at: '2026-08-12T00:00:00.000Z' });
    expect(peaks.total?.rssBytes).toBe(8_000 * MB);
  });

  it('evicts samples older than the age cap but never the peaks they set', () => {
    const start = Date.parse('2026-08-12T00:00:00.000Z');
    recordMemorySample(
      snapshot({ agents: [processSample(1, 'agent', 9_000)] }),
      new Date(start).toISOString(),
    );
    recordMemorySample(
      snapshot({ agents: [processSample(1, 'agent', 100)] }),
      new Date(start + MAX_RETAINED_AGE_MS + 60_000).toISOString(),
    );

    const history = getMemoryHistory();
    expect(history.samples).toHaveLength(1);
    expect(history.droppedSamples).toBe(1);
    expect(history.peaks.total?.rssBytes).toBe(9_000 * MB);
  });

  it('caps the retained window at MAX_RETAINED_SAMPLES', () => {
    const start = Date.parse('2026-08-12T00:00:00.000Z');
    for (let i = 0; i < MAX_RETAINED_SAMPLES + 5; i += 1) {
      recordMemorySample(
        snapshot({ agents: [processSample(1, 'agent', 1)] }),
        new Date(start + i * 1000).toISOString(),
      );
    }

    const history = getMemoryHistory();
    expect(history.samples).toHaveLength(MAX_RETAINED_SAMPLES);
    expect(history.droppedSamples).toBe(5);
    expect(history.samples[0].at).toBe(new Date(start + 5 * 1000).toISOString());
  });

  it('records a sample every time the sampler runs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const sources: MemorySources = {
      appMetrics: () => [metric(1, 'Browser', 1024)],
      mainRssBytes: () => 300 * MB,
      processTable: emptyProcessTable,
    };

    await logMemorySample(sources);
    await logMemorySample(sources);

    const history = getMemoryHistory();
    expect(history.samples).toHaveLength(2);
    expect(history.peaks.total?.rssBytes).toBe(300 * MB);
    expect(history.sampleIntervalMs).toBe(SAMPLE_INTERVAL_MS);
  });

  it('does not record anything when a sample fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sources: MemorySources = {
      appMetrics: () => {
        throw new Error('no metrics');
      },
      mainRssBytes: () => 0,
      processTable: emptyProcessTable,
    };

    expect(await logMemorySample(sources)).toBeNull();
    expect(getMemoryHistory().samples).toHaveLength(0);
  });

  it('marks a peak set by a sample with no process table as partial', () => {
    // No process table ⇒ the daemon and its agent tree are missing entirely,
    // so the total is a floor. The peak may still come from such a sample.
    recordMemorySample(
      snapshot({
        electron: [processSample(1, 'main', 400), processSample(2, 'renderer', 700)],
        processTableUnavailable: true,
      }),
      '2026-08-12T00:00:00.000Z',
    );

    const { peaks } = getMemoryHistory();
    expect(peaks.total).toEqual({
      rssBytes: 1_100 * MB,
      at: '2026-08-12T00:00:00.000Z',
      partial: true,
    });
    expect(peaks.processCount).toEqual({ count: 2, at: '2026-08-12T00:00:00.000Z', partial: true });
    // A per-kind peak cannot be half-counted, so it is never flagged
    expect(peaks.byKind.main).toEqual({ rssBytes: 400 * MB, at: '2026-08-12T00:00:00.000Z' });
  });

  it('drops the partial flag once a complete sample sets a higher peak', () => {
    recordMemorySample(
      snapshot({
        electron: [processSample(1, 'main', 400)],
        processTableUnavailable: true,
      }),
      '2026-08-12T00:00:00.000Z',
    );
    recordMemorySample(
      snapshot({
        electron: [processSample(1, 'main', 400)],
        agents: [processSample(90, 'agent', 9_000, 'claude')],
      }),
      '2026-08-12T00:01:00.000Z',
    );

    const { peaks } = getMemoryHistory();
    expect(peaks.total?.rssBytes).toBe(9_400 * MB);
    expect(peaks.total?.partial).toBeUndefined();
  });

  it('leaves peaks unflagged when every sample saw the process table', () => {
    recordMemorySample(
      snapshot({ agents: [processSample(90, 'agent', 500, 'claude')] }),
      '2026-08-12T00:00:00.000Z',
    );

    const { peaks } = getMemoryHistory();
    expect(peaks.total?.partial).toBeUndefined();
    expect(peaks.processCount?.partial).toBeUndefined();
  });

  it('prunes on read, so a stalled sampler cannot serve entries outside the window', () => {
    // A bundle is usually captured after something went wrong — exactly when
    // sampling may have stopped contributing. Without pruning on read these
    // stale entries would be serialized as if they were inside the 24 h window.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
      recordMemorySample(
        snapshot({ agents: [processSample(90, 'agent', 9_000, 'claude')] }),
        '2026-08-12T00:00:00.000Z',
      );
      expect(getMemoryHistory().samples).toHaveLength(1);

      // No further samples recorded — only the clock moves past the age cap
      vi.setSystemTime(
        new Date(Date.parse('2026-08-12T00:00:00.000Z') + MAX_RETAINED_AGE_MS + 60_000),
      );

      const history = getMemoryHistory();
      expect(history.samples).toEqual([]);
      expect(history.droppedSamples).toBe(1);
      // Peaks outlive the window, so "how big did it get" survives
      expect(history.peaks.total?.rssBytes).toBe(9_000 * MB);
      expect(history.peaks.singleProcess).toMatchObject({ pid: 90, rssBytes: 9_000 * MB });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps in-window samples when pruning on read', () => {
    vi.useFakeTimers();
    try {
      const start = Date.parse('2026-08-12T00:00:00.000Z');
      recordMemorySample(
        snapshot({ agents: [processSample(1, 'agent', 100)] }),
        new Date(start).toISOString(),
      );
      recordMemorySample(
        snapshot({ agents: [processSample(1, 'agent', 200)] }),
        new Date(start + MAX_RETAINED_AGE_MS - 60_000).toISOString(),
      );
      vi.setSystemTime(new Date(start + MAX_RETAINED_AGE_MS + 1_000));

      const history = getMemoryHistory();
      expect(history.samples).toHaveLength(1);
      expect(history.samples[0].totalRssBytes).toBe(200 * MB);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns copies so callers cannot mutate sampler state', () => {
    recordMemorySample(
      snapshot({ agents: [processSample(1, 'agent', 100)] }),
      '2026-08-12T00:00:00.000Z',
    );

    const history = getMemoryHistory();
    history.samples[0].totalRssBytes = 0;
    history.samples.length = 0;

    expect(getMemoryHistory().samples[0].totalRssBytes).toBe(100 * MB);
  });
});

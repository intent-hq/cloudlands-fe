import { describe, expect, it, vi } from 'vitest';
import {
  busiestCommands,
  checkHostLoad,
  hostLoadReminder,
  hostLoadWarning,
  psSnapshot,
} from './host-load.mjs';
import { guardHostLoad } from './run-ct-tests.mjs';

// The 2026-11-01 incident: 64 `make test-stress LOAD=1` spinners on a 32-core host.
const PS = [
  ...Array.from({ length: 64 }, () => '  99.8 yes'),
  ' 250.0 rustc',
  '  80.0 rustc',
  ' 120.5 /usr/local/bin/node',
  '   0.0 bash',
  '  12.0 ps',
  'garbage',
  '  x  bad',
].join('\n');

const BUSY = {
  load1: 112.4,
  cpus: 32,
  busiest: [{ command: 'yes', processes: 64, cpuPercent: 6387 }],
};

describe('host load check', () => {
  it('stays quiet below 1.5x the CPU count or without a load average', () => {
    const snapshot = vi.fn(() => PS);
    expect(checkHostLoad({ load: 47.9, cpus: 32, snapshot })).toBeNull();
    expect(checkHostLoad({ load: 0, cpus: 8, snapshot })).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('names the busiest commands on a loaded host', () => {
    const report = checkHostLoad({ load: 112.42, cpus: 32, psOutput: PS });
    expect(report).toEqual({
      load1: 112.4,
      cpus: 32,
      busiest: [
        { command: 'yes', processes: 64, cpuPercent: 6387 },
        { command: 'rustc', processes: 2, cpuPercent: 330 },
        { command: 'node', processes: 1, cpuPercent: 121 },
      ],
    });
    expect(hostLoadWarning(report, 'run-ct-tests')).toMatch(
      /^\[run-ct-tests\] WARNING: host load is 112\.4 on 32 CPUs \(3\.5x\); busiest commands: yes ×64 \(6387% CPU\), rustc ×2 \(330% CPU\), node \(121% CPU\)\. .*rather than the code under test/,
    );
  });

  it('still warns when ps is unavailable', () => {
    const report = checkHostLoad({ load: 100, cpus: 8, snapshot: () => '' });
    expect(hostLoadWarning(report, 'x')).toContain('busiest commands: unknown (ps unavailable)');
  });

  it('treats a failing ps as no output', () => {
    expect(psSnapshot({ spawnSyncImpl: () => ({ status: 1, stdout: 'x' }) })).toBe('');
    expect(psSnapshot({ spawnSyncImpl: () => ({ error: new Error('ENOENT') }) })).toBe('');
  });

  it('parses the real host snapshot', () => {
    expect(Array.isArray(busiestCommands(psSnapshot()))).toBe(true);
  });
});

describe('CT launcher host load guard', () => {
  it('passes exit through untouched on a quiet host', () => {
    const exit = vi.fn();
    const log = vi.fn();
    expect(guardHostLoad({ exit, check: () => null, log })).toBe(exit);
    expect(log).not.toHaveBeenCalled();
  });

  it('warns before the run and repeats it only after a failure', () => {
    const exit = vi.fn();
    const log = vi.fn();
    const guarded = guardHostLoad({ exit, check: () => BUSY, log });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[run-ct-tests\] WARNING: host load is 112\.4/);
    guarded(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenLastCalledWith(0);
    guarded(1);
    expect(log).toHaveBeenLastCalledWith(hostLoadReminder(BUSY, 'run-ct-tests'));
    expect(exit).toHaveBeenLastCalledWith(1);
  });
});

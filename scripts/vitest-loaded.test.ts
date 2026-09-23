// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BUSY_LOOP_SOURCE,
  DEFAULT_BUSY,
  VITEST_CONFIG,
  parseArgs,
  parseCpuList,
  pickBusyCount,
  pickCore,
  planRun,
} from './vitest-loaded.mjs';

describe('parseCpuList', () => {
  it('expands ranges and singletons into sorted unique cores', () => {
    expect(parseCpuList('0-31\n')).toHaveLength(32);
    expect(parseCpuList('0-3,5,7-8')).toEqual([0, 1, 2, 3, 5, 7, 8]);
    expect(parseCpuList('4,2,2-3')).toEqual([2, 3, 4]);
    expect(parseCpuList('')).toEqual([]);
  });

  it('rejects entries it cannot read', () => {
    expect(() => parseCpuList('0-x')).toThrow(/Unrecognised cpu list entry/);
  });
});

describe('pickCore', () => {
  it('defaults to the last online core', () => {
    expect(pickCore([0, 1, 2, 3], undefined)).toBe(3);
    expect(pickCore([0, 1, 2, 3], '')).toBe(3);
  });

  it('honours an online LOADED_CORE and rejects an offline or malformed one', () => {
    expect(pickCore([0, 1, 2, 3], '1')).toBe(1);
    expect(() => pickCore([0, 1, 2, 3], '9')).toThrow(/not an online core/);
    expect(() => pickCore([0, 1], 'two')).toThrow(/non-negative integer/);
    expect(() => pickCore([0, 1], '-1')).toThrow(/non-negative integer/);
  });

  it('fails when no core is online rather than pinning to nothing', () => {
    expect(() => pickCore([], undefined)).toThrow(/No online core/);
  });
});

describe('pickBusyCount', () => {
  it('defaults to three loops and honours LOADED_BUSY', () => {
    expect(pickBusyCount(undefined)).toBe(DEFAULT_BUSY);
    expect(pickBusyCount('')).toBe(DEFAULT_BUSY);
    expect(pickBusyCount('0')).toBe(0);
    expect(pickBusyCount('5')).toBe(5);
    expect(() => pickBusyCount('1.5')).toThrow(/non-negative integer/);
  });
});

describe('parseArgs', () => {
  it('requires a file or filter so a typo cannot run the whole suite pinned', () => {
    expect(() => parseArgs([])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['--reporter=verbose'])).toThrow(/No test file or filter given/);
    expect(() => parseArgs(['--'])).toThrow(/No test file or filter given/);
  });

  it('drops the separators pnpm forwards and keeps vitest flags verbatim', () => {
    expect(parseArgs(['src/a.test.ts'])).toEqual(['src/a.test.ts']);
    expect(parseArgs(['src/a.test.ts', '--', '--reporter=verbose', '-t', 'name'])).toEqual([
      'src/a.test.ts',
      '--reporter=verbose',
      '-t',
      'name',
    ]);
  });
});

describe('planRun', () => {
  const base = {
    execPath: '/usr/bin/node',
    vitestBin: '/repo/node_modules/vitest/vitest.mjs',
    vitestArgs: ['src/a.test.ts', '--reporter=verbose'],
    core: 31,
    busy: 3,
  };

  it('pins the busy loops and a one-worker vitest to the same core', () => {
    const plan = planRun({ ...base, pinned: true });
    expect(plan.busy).toHaveLength(3);
    for (const loop of plan.busy) {
      expect(loop).toEqual({
        executable: 'taskset',
        args: ['-c', '31', '/usr/bin/node', '-e', BUSY_LOOP_SOURCE],
      });
    }
    expect(plan.vitest).toEqual({
      executable: 'taskset',
      args: [
        '-c',
        '31',
        '/usr/bin/node',
        '/repo/node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        VITEST_CONFIG,
        '--maxWorkers=1',
        'src/a.test.ts',
        '--reporter=verbose',
      ],
    });
    expect(plan.notice).toMatch(/pinned to core 31 with 3 busy loop/);
  });

  it('runs unpinned with a weaker-reproduction notice when taskset is unavailable', () => {
    const plan = planRun({ ...base, core: undefined, busy: 2, pinned: false });
    expect(plan.busy).toHaveLength(2);
    expect(plan.busy[0]).toEqual({
      executable: '/usr/bin/node',
      args: ['-e', BUSY_LOOP_SOURCE],
    });
    expect(plan.vitest.executable).toBe('/usr/bin/node');
    expect(plan.vitest.args).toEqual([
      '/repo/node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      VITEST_CONFIG,
      '--maxWorkers=1',
      'src/a.test.ts',
      '--reporter=verbose',
    ]);
    expect(plan.notice).toMatch(/no taskset/);
    expect(plan.notice).toMatch(/weaker/);
  });

  it('never sets CI in the vitest command line', () => {
    const plan = planRun({ ...base, pinned: true });
    expect(plan.vitest.args.join(' ')).not.toMatch(/\bCI\b/);
  });
});

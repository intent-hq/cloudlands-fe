import { describe, expect, it } from 'vitest';
import {
  ROLE_BUILD,
  ROLE_LONG,
  classifyClose,
  classifySignal,
  parseCommands,
  resolveKillTimeout,
} from './dev-stack-lib.mjs';

describe('parseCommands', () => {
  it('parses interleaved --build and --long flags in order', () => {
    expect(
      parseCommands(['--build', 'npm run build:main:dev', '--long', 'npm run dev:renderer']),
    ).toEqual([
      { role: ROLE_BUILD, command: 'npm run build:main:dev' },
      { role: ROLE_LONG, command: 'npm run dev:renderer' },
    ]);
  });

  it('rejects unknown flags', () => {
    expect(() => parseCommands(['--watch', 'x', '--long', 'y'])).toThrow(/unknown argument/);
  });

  it('rejects a flag without a command string', () => {
    expect(() => parseCommands(['--long'])).toThrow(/requires a command string/);
    expect(() => parseCommands(['--build', '--long', 'x'])).toThrow(/requires a command string/);
  });

  it('requires at least one --long command', () => {
    expect(() => parseCommands(['--build', 'npm run build'])).toThrow(/--long/);
  });
});

describe('classifyClose', () => {
  const close = (exitCode: number | string, killed = false) => ({ exitCode, killed });

  it('ignores a build exiting 0 (overlapped-build startup)', () => {
    expect(classifyClose(ROLE_BUILD, close(0), false)).toEqual({ action: 'ignore' });
  });

  it('tears down on a build failure', () => {
    expect(classifyClose(ROLE_BUILD, close(2), false)).toEqual({
      action: 'teardown',
      failure: true,
      exitCode: 2,
    });
  });

  it('tears down without failure when a long-running member exits 0 (Cmd-Q)', () => {
    expect(classifyClose(ROLE_LONG, close(0), false)).toEqual({
      action: 'teardown',
      failure: false,
      exitCode: 0,
    });
  });

  it('tears down with failure when a long-running member crashes', () => {
    expect(classifyClose(ROLE_LONG, close(1), false)).toEqual({
      action: 'teardown',
      failure: true,
      exitCode: 1,
    });
  });

  it('treats a signal exit code (string) on a long-running member as failure exit 1', () => {
    expect(classifyClose(ROLE_LONG, close('SIGTERM'), false)).toEqual({
      action: 'teardown',
      failure: true,
      exitCode: 1,
    });
  });

  it('ignores closes for commands the runner killed itself', () => {
    expect(classifyClose(ROLE_LONG, close('SIGTERM', true), false)).toEqual({ action: 'ignore' });
    expect(classifyClose(ROLE_BUILD, close(1, true), false)).toEqual({ action: 'ignore' });
  });

  it('ignores every close once teardown is in progress', () => {
    expect(classifyClose(ROLE_LONG, close(1), true)).toEqual({ action: 'ignore' });
    expect(classifyClose(ROLE_BUILD, close(1), true)).toEqual({ action: 'ignore' });
  });
});

describe('classifySignal', () => {
  it('starts a graceful teardown on the first signal', () => {
    expect(classifySignal(1)).toEqual({ action: 'graceful' });
  });

  it('escalates to force-kill on repeated signals', () => {
    expect(classifySignal(2)).toEqual({ action: 'force-kill' });
    expect(classifySignal(3)).toEqual({ action: 'force-kill' });
  });
});

describe('resolveKillTimeout', () => {
  it('uses the env value when it is a non-negative number', () => {
    expect(resolveKillTimeout('2500')).toBe(2500);
    expect(resolveKillTimeout('0')).toBe(0);
  });

  it('falls back for missing or invalid values', () => {
    expect(resolveKillTimeout(undefined)).toBe(5000);
    expect(resolveKillTimeout('abc')).toBe(5000);
    expect(resolveKillTimeout('-1')).toBe(5000);
  });
});

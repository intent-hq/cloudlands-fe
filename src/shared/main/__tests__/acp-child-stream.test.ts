import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Wire-level tests for the ChildProcess-shaped `startAcpChildStream` helper
 * introduced for AUDIT-R1c-FE. The helper wraps `host.execStream`
 * (PROTOCOL.md §5.14) so the four ACP probes can drive their existing
 * stdio JSON-RPC scaffolding through the daemon instead of a local
 * `child_process.spawn`.
 */

const { mockHostExecStream, resolveDone, rejectDone, latestHandle } = vi.hoisted(() => {
  const state: {
    resolveDone: (r: { ok: boolean; exitCode?: number }) => void;
    rejectDone: (e: Error) => void;
    handle: {
      onStdout?: (chunk: Buffer) => void;
      onStderr?: (chunk: Buffer) => void;
      writeStdin: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    } | null;
  } = { resolveDone: () => {}, rejectDone: () => {}, handle: null };

  const mockHostExecStream = vi.fn(async (_command: string, options: any = {}) => {
    const done = new Promise<{ ok: boolean; exitCode?: number }>((resolve, reject) => {
      state.resolveDone = resolve;
      state.rejectDone = reject;
    });
    const writeStdin = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
    state.handle = {
      onStdout: options.onStdout,
      onStderr: options.onStderr,
      writeStdin,
      cancel,
    };
    return {
      requestId: 'req-test',
      writeStdin,
      writeStdinBase64: vi.fn(),
      endStdin: vi.fn().mockResolvedValue(undefined),
      cancel,
      done,
    };
  });

  return {
    mockHostExecStream,
    resolveDone: (r: { ok: boolean; exitCode?: number }) => state.resolveDone(r),
    rejectDone: (e: Error) => state.rejectDone(e),
    latestHandle: () => state.handle,
  };
});

vi.mock('../host-exec-stream', () => ({
  hostExecStream: mockHostExecStream,
}));

vi.mock('../../logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import { startAcpChildStream } from '../acp-child-stream';

describe('startAcpChildStream', () => {
  beforeEach(() => {
    mockHostExecStream.mockClear();
  });

  it('forwards command + args + timeout to hostExecStream and streams stdout/stderr chunks', async () => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = await startAcpChildStream('/usr/local/bin/droid', {
      args: ['exec', '--output-format', 'acp'],
      timeoutMs: 15000,
    });
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    expect(mockHostExecStream).toHaveBeenCalledWith(
      '/usr/local/bin/droid',
      expect.objectContaining({
        args: ['exec', '--output-format', 'acp'],
        timeoutMs: 15000,
        onStdout: expect.any(Function),
        onStderr: expect.any(Function),
      }),
    );

    latestHandle()!.onStdout?.(Buffer.from('{"jsonrpc":"2.0","id":1}\n', 'utf8'));
    latestHandle()!.onStderr?.(Buffer.from('warn\n', 'utf8'));
    await new Promise<void>((r) => setImmediate(r));

    expect(Buffer.concat(stdout).toString('utf8')).toBe('{"jsonrpc":"2.0","id":1}\n');
    expect(Buffer.concat(stderr).toString('utf8')).toBe('warn\n');
  });

  it('routes stdin.write through host.execStream.write', async () => {
    const child = await startAcpChildStream('droid');
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
    await new Promise<void>((r) => setImmediate(r));
    expect(latestHandle()!.writeStdin).toHaveBeenCalledWith(
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
    );
  });

  it('emits exit + close with the daemon-reported exit code', async () => {
    const child = await startAcpChildStream('droid');
    const events: Array<{ type: string; code: number | null }> = [];
    child.on('exit', (code) => events.push({ type: 'exit', code: code ?? null }));
    child.on('close', (code) => events.push({ type: 'close', code: code ?? null }));

    resolveDone({ ok: true, exitCode: 0 });
    await new Promise<void>((r) => setImmediate(r));

    expect(events).toEqual([
      { type: 'exit', code: 0 },
      { type: 'close', code: 0 },
    ]);
  });

  it('emits error when host.execStream rejects (honest degradation)', async () => {
    const child = await startAcpChildStream('droid');
    const errors: Error[] = [];
    child.on('error', (e: Error) => errors.push(e));

    rejectDone(new Error('transport down'));
    await new Promise<void>((r) => setImmediate(r));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('transport down');
  });

  it('kill() invokes host.execStream.cancel on the daemon and is idempotent', async () => {
    const child = await startAcpChildStream('droid');
    child.kill();
    child.kill();
    await new Promise<void>((r) => setImmediate(r));
    expect(latestHandle()!.cancel).toHaveBeenCalledTimes(1);
  });
});

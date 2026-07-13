/**
 * ChildProcess-shaped handle over `host.execStream` (PROTOCOL.md §5.14).
 *
 * ACP probes (`codex`, `claude-code`, `pi`, `droid`) need a bidirectional
 * stdio JSON-RPC handshake — line-delimited `initialize` / `session/new`
 * writes with streamed line-delimited responses coming back. `host.execStream`
 * already exposes that seam (stdin writes via `host.execStream.write`, stdout/
 * stderr via `host:exec:{stdout,stderr}` events, exit via `host:exec:exit`).
 *
 * Rather than rewrite each probe's transport, this helper wraps a
 * `HostExecStreamHandle` in a ChildProcess-like façade so probes can keep
 * their existing JSON-RPC scaffolding (`stdout.on('data')`,
 * `stdin.write(line)`, `on('exit'|'close'|'error')`, `kill()`) and just swap
 * `spawn(...)` for `startAcpChildStream(...)`.
 *
 * `kill()` invokes `host.execStream.cancel` — the daemon reaps the entire
 * process tree, replacing the retired local `killChildProcessTree` path.
 */
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import { Buffer } from 'node:buffer';
import { Logger } from '../logger';
import {
  hostExecStream,
  type HostExecStreamHandle,
  type HostExecStreamOptions,
} from './host-exec-stream';

const logger = new Logger('AcpChildStream');

/** Options for `startAcpChildStream`. `onStdout`/`onStderr` are owned internally. */
export type AcpChildStreamOptions = Omit<HostExecStreamOptions, 'onStdout' | 'onStderr'>;

/**
 * ChildProcess-shaped handle. Matches the subset of the ChildProcess API the
 * four ACP probes use — `stdout`/`stderr` as Readable streams,`stdin` as a
 * Writable, event emitter with `exit` / `close` / `error`, and `kill()`.
 */
export interface AcpChildStream extends EventEmitter {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly stdin: Writable;
  /** Cancel the daemon-side process tree. Idempotent; fire-and-forget. */
  kill(): void;
}

class AcpStdin extends Writable {
  constructor(private readonly handle: HostExecStreamHandle) {
    super({ decodeStrings: false });
  }
  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (err?: Error | null) => void,
  ): void {
    const data =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);
    this.handle.writeStdin(data).then(
      () => callback(),
      (err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)));
      },
    );
  }
}

class AcpChildStreamImpl extends EventEmitter implements AcpChildStream {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly stdin: Writable;
  private killed = false;

  constructor(
    private readonly handle: HostExecStreamHandle,
    stdout: PassThrough,
    stderr: PassThrough,
  ) {
    super();
    this.stdout = stdout;
    this.stderr = stderr;
    this.stdin = new AcpStdin(handle);
    // Swallow default EPIPE-style stdin errors so callers that never wire an
    // `error` listener do not crash the main process when the daemon rejects
    // a late write after the child exited.
    this.stdin.on('error', (error) => {
      logger.debug('acp-child-stream stdin error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    handle.done.then(
      (result) => {
        const code = typeof result.exitCode === 'number' ? result.exitCode : null;
        this.stdout.end();
        this.stderr.end();
        this.emit('exit', code, null);
        this.emit('close', code, null);
      },
      (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        this.stdout.end();
        this.stderr.end();
        this.emit('error', err);
        this.emit('close', null, null);
      },
    );
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.handle.cancel().catch((err: unknown) => {
      logger.debug('host.execStream.cancel from kill() failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/**
 * Start a daemon-hosted child process suitable for ACP JSON-RPC handshakes.
 *
 * Streams stdout / stderr via `host:exec:{stdout,stderr}` and forwards writes
 * to `host.execStream.write`. The returned handle exposes the ChildProcess-
 * shaped API the four probes already speak.
 */
export async function startAcpChildStream(
  command: string,
  options: AcpChildStreamOptions = {},
): Promise<AcpChildStream> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const handle = await hostExecStream(command, {
    ...options,
    onStdout: (chunk: Buffer) => {
      stdout.write(chunk);
    },
    onStderr: (chunk: Buffer) => {
      stderr.write(chunk);
    },
  });
  return new AcpChildStreamImpl(handle, stdout, stderr);
}

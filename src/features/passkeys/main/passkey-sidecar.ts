import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Logger } from '../../../shared/logger';

const logger = new Logger('PasskeySidecar');

/** Spec §11.3 error codes. */
export type SidecarErrorCode =
  | 'NotAllowed'
  | 'InvalidState'
  | 'NotSupported'
  | 'Security'
  | 'Abort'
  | 'Timeout'
  | 'PinLocked'
  | 'BluetoothUnavailable'
  | 'Unknown';

export class SidecarError extends Error {
  constructor(
    readonly code: SidecarErrorCode | string,
    message: string,
  ) {
    super(message);
    this.name = 'SidecarError';
  }
}

export interface SidecarHello {
  protocol: number;
  version: string;
  transports: { hybrid: boolean; usb: boolean; device: boolean };
  bluetooth: 'on' | 'off' | 'missing';
}

/** Spec §11.2 events. */
export type SidecarEvent =
  | { event: 'qr'; ceremony: string; data: string }
  | { event: 'status'; ceremony: string; state: string }
  | {
      event: 'pin-needed';
      ceremony: string;
      kind: 'usb' | 'device';
      attemptsLeft?: number;
      retryAfterMs?: number;
      wrongPin?: boolean;
      oldPin?: boolean;
    }
  | {
      event: 'choose-account';
      ceremony: string;
      accounts: Array<{ index: number; userName?: string; userDisplayName?: string }>;
    };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** How many unexpected exits within {@link CRASH_WINDOW_MS} disable restarts for a while. */
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60_000;
const SUPPORTED_PROTOCOL = 1;

/**
 * One `intent-passkey --stdio` process, started on first use and kept while
 * Intent runs. Requests and responses are single-line JSON objects.
 */
export class PasskeySidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private hello: Promise<SidecarHello> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, (event: SidecarEvent) => void>();
  private crashes: number[] = [];
  private disposed = false;

  constructor(private readonly binaryPath: string) {}

  /** Starts the process when needed and returns its cached `hello` result. */
  start(): Promise<SidecarHello> {
    if (this.disposed) return Promise.reject(new SidecarError('Unknown', 'Sidecar disposed'));
    if (this.child && this.hello) return this.hello;
    const now = Date.now();
    this.crashes = this.crashes.filter((at) => now - at < CRASH_WINDOW_MS);
    if (this.crashes.length >= CRASH_LIMIT) {
      return Promise.reject(new SidecarError('Unknown', 'Passkey helper keeps exiting'));
    }
    this.spawnChild();
    this.hello = this.request<SidecarHello>('hello', {}).then((hello) => {
      if (hello.protocol !== SUPPORTED_PROTOCOL) {
        throw new SidecarError('NotSupported', `Unsupported protocol ${hello.protocol}`);
      }
      return hello;
    });
    this.hello.catch(() => {
      this.hello = null;
    });
    return this.hello;
  }

  /** Sends a request; `onEvent` receives events whose `ceremony` is this request's id. */
  request<T>(
    method: string,
    params: object,
    options: { id?: string; onEvent?: (event: SidecarEvent) => void } = {},
  ): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new SidecarError('Unknown', 'Passkey helper not running'));
    const id = options.id ?? randomUUID();
    if (options.onEvent) this.listeners.set(id, options.onEvent);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) this.settle(id, undefined, new SidecarError('Unknown', 'Write failed'));
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.child = null;
    this.failAll('Sidecar disposed');
  }

  private spawnChild(): void {
    const child = spawn(this.binaryPath, ['--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    // stderr is logs only (spec §11); keep a bounded tail in our log.
    createInterface({ input: child.stderr }).on('line', (line) => {
      logger.debug('sidecar', { line: line.slice(0, 500) });
    });
    child.stdin.on('error', () => {});
    child.once('error', (error) => {
      logger.warn('Passkey helper failed to start', { error: error.message });
      this.onExit(child);
    });
    child.once('exit', (code, signal) => {
      logger.info('Passkey helper exited', { code, signal });
      this.onExit(child);
    });
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = null;
    this.hello = null;
    if (!this.disposed) this.crashes.push(Date.now());
    this.failAll('Passkey helper exited');
  }

  private failAll(message: string): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, undefined, new SidecarError('Unknown', message));
    }
  }

  private settle(id: string, result: unknown, error?: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.listeners.delete(id);
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  private onLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      logger.warn('Ignoring a non-JSON line from the passkey helper');
      return;
    }
    if (typeof message.event === 'string' && typeof message.ceremony === 'string') {
      this.listeners.get(message.ceremony)?.(message as unknown as SidecarEvent);
      return;
    }
    if (typeof message.id !== 'string') return;
    const error = message.error as { code?: unknown; message?: unknown } | undefined;
    if (error && typeof error === 'object') {
      this.settle(
        message.id,
        undefined,
        new SidecarError(
          typeof error.code === 'string' ? error.code : 'Unknown',
          typeof error.message === 'string' ? error.message : '',
        ),
      );
      return;
    }
    this.settle(message.id, message.result ?? {});
  }
}

/** Spec §11.1 `device.list` entry. */
export interface SidecarDeviceCredential {
  credentialId: string;
  rpId: string;
  userName?: string;
  userDisplayName?: string;
  createdAt: number;
  lastUsedAt?: number | null;
}

/**
 * One app connection (`docs/protocol/methods/apps.md` → "Attach"): a new
 * connection to the daemon on the host's own transport, whose first request is
 * `app.session.attach { token }`, before `client.hello` and anything else. On
 * success the daemon binds it to the app principal for life.
 *
 * Deliberately not a `JsonRpcClient`: that client sends `client.hello` on
 * connect, reconnects on its own and answers reverse requests. An app
 * connection does none of that. When it closes (the session ended, the daemon
 * restarted, a transport drop), every pending call rejects with
 * `AppDisconnectedError` and the host decides what happens next.
 */
import type { Duplex } from 'stream';
import { StringDecoder } from 'string_decoder';
import type { IntentAppSession } from '../../../shared/intent-apps/intent-apps-types';
import { AppDisconnectedError, AppRpcError } from './app-bridge';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const ATTACH_TIMEOUT_MS = 10_000;

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class AppConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  private constructor(private readonly socket: Duplex) {
    socket.on('data', (chunk: Buffer | string) => this.onData(chunk));
    socket.on('error', () => this.finish());
    socket.on('close', () => this.finish());
    socket.on('end', () => this.finish());
  }

  /**
   * Connect and attach. Rejects with the daemon's error (`session-invalid`,
   * `attach-not-first`, `-32003`) or `AppDisconnectedError`; the connection is
   * closed on any failure.
   */
  static async attach(
    createSocket: () => Duplex,
    token: string,
  ): Promise<{ connection: AppConnection; session: IntentAppSession }> {
    const socket = createSocket();
    const connection = new AppConnection(socket);
    try {
      await connection.waitForConnect();
      const session = (await connection.request(
        'app.session.attach',
        { token },
        ATTACH_TIMEOUT_MS,
      )) as IntentAppSession;
      return { connection, session };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Runs once when the connection closes for any reason. */
  onClose(listener: () => void): () => void {
    if (this.closed) {
      listener();
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new AppDisconnectedError());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new AppRpcError(-32603, `${method} timed out`, { code: 'timeout' }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new AppDisconnectedError());
      }
    });
  }

  close(): void {
    if (!this.socket.destroyed) this.socket.destroy();
    this.finish();
  }

  private waitForConnect(): Promise<void> {
    const socket = this.socket as Duplex & { connecting?: boolean; readyState?: string };
    // A net.Socket that is already open, or a stream with no connect phase.
    if (socket.connecting === false || socket.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new AppDisconnectedError('The app connection did not open'));
      }, ATTACH_TIMEOUT_MS);
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new AppDisconnectedError('The app connection did not open'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('connect', onConnect);
        this.closeListeners.delete(onClose);
      };
      this.socket.once('connect', onConnect);
      this.closeListeners.add(onClose);
    });
  }

  private onData(chunk: Buffer | string): void {
    if (this.closed) return;
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown };
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      // App connections receive no events or reverse requests: only answers.
      if (typeof message?.id !== 'number' || message.method !== undefined) continue;
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      const error = message.error as { code?: unknown; message?: unknown; data?: unknown } | null;
      if (error && typeof error === 'object') {
        entry.reject(
          new AppRpcError(
            typeof error.code === 'number' ? error.code : -32603,
            typeof error.message === 'string' ? error.message : 'Request failed',
            error.data,
          ),
        );
      } else {
        entry.resolve(message.result);
      }
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new AppDisconnectedError());
    }
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener();
  }
}

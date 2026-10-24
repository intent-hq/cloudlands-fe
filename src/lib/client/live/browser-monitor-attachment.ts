import { supportsReviewMonitoring } from '$shared/types/pr-monitor';
import { BackendError, type BackendNotification } from './backend-transport-types';
import type { BrowserWebSocketLike } from './browser-websocket-transport';

/** One physical recipient, bound to an acknowledged ordinary source generation. */
export class BrowserMonitorAttachment {
  readonly ready: Promise<void>;
  private acknowledged = false;
  private closed = false;
  private id = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(notification: BackendNotification) => void>();
  private rejectReady!: (error: Error) => void;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly socket: BrowserWebSocketLike,
    clientId: string,
    version: number,
    private readonly currentSource: () => boolean,
    private readonly timeoutMs: number,
    connectTimeoutMs: number,
    private readonly onFailure: () => void,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      socket.onopen = () => {
        if (!this.current()) return this.fail();
        void this.send('client.hello', {
          clientId,
          connectionRole: 'review-monitor',
          capabilities: { reviewMonitoring: version },
        }).then(
          (value) => {
            const reply = value as {
              clientId?: unknown;
              connectionRole?: unknown;
              server?: { capabilities?: { reviewMonitoring?: unknown } };
            } | null;
            if (
              !this.current() ||
              reply?.clientId !== clientId ||
              reply?.connectionRole !== 'review-monitor' ||
              !supportsReviewMonitoring(reply?.server?.capabilities?.reviewMonitoring)
            )
              return this.fail();
            this.acknowledged = true;
            clearTimeout(this.timer);
            resolve();
          },
          () => this.fail(),
        );
      };
    });
    this.timer = setTimeout(() => this.fail(), connectTimeoutMs);
    socket.onerror = () => this.fail();
    socket.onclose = () => this.fail();
    socket.onmessage = ({ data }) => {
      if (!this.current() || typeof data !== 'string') return;
      let frame: {
        id?: unknown;
        method?: unknown;
        result?: unknown;
        error?: { code?: unknown; message?: unknown; data?: unknown };
        params?: unknown;
      };
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      // Notifications can never resolve a request, including a hello.
      if (typeof frame.method === 'string') {
        if (frame.id != null) {
          try {
            socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: frame.id,
                error: { code: -32601, message: 'Method not found' },
              }),
            );
          } catch {
            this.fail();
          }
          return;
        }
        if (this.acknowledged)
          for (const listener of [...this.listeners])
            listener({ method: frame.method, params: frame.params });
        return;
      }
      if (typeof frame.id !== 'number') return;
      const entry = this.pending.get(frame.id);
      if (!entry) return;
      this.pending.delete(frame.id);
      clearTimeout(entry.timer);
      if (frame.error) {
        const data = frame.error.data;
        const code =
          data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
            ? data.code
            : 'SERVER_ERROR';
        entry.reject(
          new BackendError({
            code,
            message:
              typeof frame.error.message === 'string'
                ? frame.error.message
                : 'Monitor request failed',
            data,
            rpcCode: typeof frame.error.code === 'number' ? frame.error.code : undefined,
          }),
        );
      } else entry.resolve(frame.result);
    };
  }

  current(): boolean {
    return !this.closed && this.currentSource();
  }

  onNotification(handler: (notification: BackendNotification) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (!this.acknowledged || method === 'client.hello') return Promise.reject(this.unavailable());
    return this.send(method, params) as Promise<T>;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.acknowledged = false;
    clearTimeout(this.timer);
    const error = this.unavailable();
    this.rejectReady(error);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
    this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
    try {
      this.socket.close();
    } catch {
      /* Already closed. */
    }
  }

  private fail(): void {
    if (this.closed) return;
    this.close();
    this.onFailure();
  }

  private unavailable(): BackendError {
    return new BackendError({
      code: 'PR_MONITOR_SESSION_RETIRED',
      message: 'Monitor attachment unavailable',
    });
  }

  private send(method: string, params: unknown): Promise<unknown> {
    if (!this.current()) return Promise.reject(this.unavailable());
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BackendError({ code: 'TIMEOUT', message: `JSON-RPC request timed out: ${method}` }),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch {
        this.fail();
      }
    });
  }
}

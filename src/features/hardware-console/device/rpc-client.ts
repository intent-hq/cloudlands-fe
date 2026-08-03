/**
 * Typed JSON-RPC client for the vendor channel.
 *
 * Wire shape (see cm2-probe README / work-louder-oai PROTOCOL.md): requests
 * omit the `"jsonrpc"` member — `{"method":"sys.version","params":null,"id":1}`;
 * responses are `{"id":1,"result":{...}}` or `{"id":1,"error":{...}}`.
 * Notifications omit `id` and use abbreviated `m`/`p` keys
 * (`{"m":"v.oai.hid","p":{...}}`). The device also originates its own
 * requests (e.g. `host.focused_app` AppSense polls) carrying an `id` that we
 * must answer.
 *
 * Platform-neutral: talks to the wire through the `RpcMessagePort` seam.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger('HardwareConsoleRpc');

const DEFAULT_REQUEST_TIMEOUT_MS = 2000;

/** JSON-RPC "method not found" error code, mirrored in error replies. */
const METHOD_NOT_FOUND = -32601;
const HANDLER_FAILED = -32000;

/**
 * Host-originated command methods (we call these on the device). Seeing one
 * arrive as a device request means our own outbound request was looped back
 * to an inputreport (e.g. echoed across another granted collection of the
 * same device). Still answered with method-not-found so no id is left
 * dangling, but logged at debug to avoid per-frame warn spam.
 */
const KNOWN_HOST_METHODS = new Set(['v.oai.rgbcfg', 'v.oai.thstatus']);

export interface RpcMessagePort {
  sendMessage(message: unknown): Promise<void>;
}

export interface RpcNotification {
  method: string;
  params: unknown;
}

export type DeviceRequestHandler = (params: unknown) => unknown | Promise<unknown>;

interface PendingCall {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RpcClientOptions {
  requestTimeoutMs?: number;
}

function readMethod(message: Record<string, unknown>): string | undefined {
  const method = message['method'] ?? message['m'];
  return typeof method === 'string' ? method : undefined;
}

function readParams(message: Record<string, unknown>): unknown {
  return message['params'] ?? message['p'] ?? null;
}

export class HardwareRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly notificationListeners = new Set<(notification: RpcNotification) => void>();
  private readonly requestHandlers = new Map<string, DeviceRequestHandler>();
  private readonly requestTimeoutMs: number;
  private disposed = false;

  constructor(
    private readonly port: RpcMessagePort,
    options: RpcClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Send one JSON-RPC request and resolve with the matching response's
   * `result`; firmware `error` members and timeouts reject.
   */
  call<T = unknown>(method: string, params: unknown = null): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error(`rpc client disposed; cannot call '${method}'`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `timed out after ${this.requestTimeoutMs}ms waiting for '${method}' (id ${id})`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      // Top-level key order matters on the wire for fragmented requests: the
      // live-verified reference (cm2-probe, serde_json's alphabetical maps)
      // sends `{"id":…,"method":…,"params":…}`, keeping the envelope in the
      // FIRST 61-byte fragment. With `id` serialized last, multi-packet sends
      // (e.g. full v.oai.thstatus frames) fail on real hardware with
      // {"code":400,"message":"Missing method"}; single-packet sends work
      // either way.
      this.port.sendMessage({ id, method, params }).catch((error: unknown) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Subscribe to device notifications (messages without an `id`). */
  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  /**
   * Register a responder for device-originated requests (e.g.
   * `host.focused_app`). Unhandled methods are answered with a
   * method-not-found error so the device does not wait on a dead id.
   */
  setRequestHandler(method: string, handler: DeviceRequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  /** Feed one reassembled channel-2 JSON message into the client. */
  handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      logger.warn('Ignoring non-object RPC message');
      return;
    }
    const record = message as Record<string, unknown>;
    const id = record['id'];
    const method = readMethod(record);

    if (method !== undefined && id !== undefined) {
      this.handleDeviceRequest(method, readParams(record), id);
      return;
    }
    if (typeof id === 'number') {
      this.handleResponse(id, record);
      return;
    }
    if (method !== undefined) {
      const notification: RpcNotification = { method, params: readParams(record) };
      for (const listener of this.notificationListeners) listener(notification);
      return;
    }
    // Bare channel-2 objects with neither id nor method exist (e.g. the CM2
    // vendor-mode joystick stream `{"a":0.76,"d":1}`); they are consumed via
    // the transport-level raw-message hook, not the RPC layer. Debug-level to
    // avoid per-sample warn spam.
    logger.debug('Ignoring RPC message with neither id nor method');
  }

  /** Reject all in-flight calls; further calls fail immediately. */
  dispose(reason = 'connection closed'): void {
    this.disposed = true;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`${reason} (while waiting for '${entry.method}', id ${id})`));
    }
    this.pending.clear();
  }

  private handleResponse(id: number, record: Record<string, unknown>): void {
    const entry = this.pending.get(id);
    if (!entry) {
      // Stale (timed out / pre-reconnect) or foreign (another client's)
      // response — drop quietly; debug-level to avoid warn spam.
      logger.debug('Dropping response for unknown or stale id', { id });
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if ('error' in record) {
      entry.reject(new Error(`device returned error: ${JSON.stringify(record['error'])}`));
      return;
    }
    entry.resolve(record['result'] ?? null);
  }

  private handleDeviceRequest(method: string, params: unknown, id: unknown): void {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      if (KNOWN_HOST_METHODS.has(method)) {
        logger.debug('No handler for looped-back host method', { method });
      } else {
        logger.warn('No handler for device request', { method });
      }
      this.reply({ id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
      return;
    }
    Promise.resolve()
      .then(() => handler(params))
      .then((result) => this.reply({ id, result: result ?? null }))
      .catch((error: unknown) => {
        logger.warn('Device request handler failed', { method, error: String(error) });
        this.reply({ id, error: { code: HANDLER_FAILED, message: String(error) } });
      });
  }

  private reply(message: unknown): void {
    this.port.sendMessage(message).catch((error: unknown) => {
      logger.warn('Failed to send device-request reply', { error: String(error) });
    });
  }
}

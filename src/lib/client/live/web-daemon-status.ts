/**
 * Web-platform daemon connection status registry.
 *
 * In dev:web the daemon-health service reads `backend:get-status` and listens
 * on `backend:status` through the browser mock's `window.electronAPI`, while
 * the actual daemon connection is the lazily-created
 * `BrowserWebSocketTransport` singleton. This tiny leaf module decouples the
 * two: the transport factory registers the live transport as the status
 * source, and the browser mock looks it up lazily (with a registration hook
 * for push events) — avoiding a circular import between browser-mock and the
 * transport modules (the mock is installed before the transport exists).
 */

/** Connection status mirroring the main-process ConnectionStatus union. */
export type WebDaemonConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Live daemon-connection status surface exposed to the browser mock. */
export interface WebDaemonStatusSource {
  getStatus(): WebDaemonConnectionStatus;
  /** Sanitized daemon target (WS URL without userinfo/query — no secrets). */
  getTarget(): string;
  /** Subscribe to status transitions; returns an unsubscriber. */
  onStatusChange(handler: (status: WebDaemonConnectionStatus) => void): () => void;
}

let currentSource: WebDaemonStatusSource | null = null;
const registrationHandlers = new Set<(source: WebDaemonStatusSource) => void>();

/** Register the live status source (called by the transport factory). */
export function registerWebDaemonStatusSource(source: WebDaemonStatusSource): void {
  currentSource = source;
  for (const handler of [...registrationHandlers]) handler(source);
}

/** Current status source, or `null` before the WS transport is created. */
export function getWebDaemonStatusSource(): WebDaemonStatusSource | null {
  return currentSource;
}

/**
 * Invoke `handler` with the current source (if already registered) and on
 * every future registration. Returns an unsubscriber.
 */
export function onWebDaemonStatusSourceRegistered(
  handler: (source: WebDaemonStatusSource) => void,
): () => void {
  registrationHandlers.add(handler);
  if (currentSource) handler(currentSource);
  return () => registrationHandlers.delete(handler);
}

/** Test-only: clear the registered source and registration hooks. */
export function resetWebDaemonStatusSourceForTests(): void {
  currentSource = null;
  registrationHandlers.clear();
}

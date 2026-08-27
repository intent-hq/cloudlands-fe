/**
 * Extract the connected daemon's build identity from a `client.hello` result
 * (`server.version` / `server.buildCommit`, PROTOCOL §5.17) so backend.ipc.ts
 * can log it once at INFO (intent-hq/monorepo#3649).
 *
 * The hello handshake re-runs on every (re)connect, so the caller dedupes on
 * {@link daemonHelloBuildKey} to avoid one log line per reconnect. Extracted
 * from `backend.ipc.ts` so the parse logic is testable without the Electron
 * module graph.
 */

/** The daemon build identity carried by a `client.hello` result. */
export interface DaemonHelloBuildInfo {
  version: string;
  buildCommit: string | null;
}

/**
 * Parse `server.version` / `server.buildCommit` out of an untrusted
 * `client.hello` result. Returns `null` when the result lacks a well-formed
 * `server.version` (older daemons, malformed payloads).
 */
export function extractDaemonHelloBuildInfo(helloResult: unknown): DaemonHelloBuildInfo | null {
  const server =
    helloResult && typeof helloResult === 'object'
      ? (helloResult as { server?: unknown }).server
      : undefined;
  const version =
    server && typeof server === 'object' ? (server as { version?: unknown }).version : undefined;
  if (typeof version !== 'string' || version.length === 0) return null;
  const buildCommit =
    server && typeof server === 'object'
      ? (server as { buildCommit?: unknown }).buildCommit
      : undefined;
  return {
    version,
    buildCommit: typeof buildCommit === 'string' && buildCommit.length > 0 ? buildCommit : null,
  };
}

/** Stable dedupe key for a daemon build identity. */
export function daemonHelloBuildKey(info: DaemonHelloBuildInfo): string {
  return `${info.version}@${info.buildCommit ?? ''}`;
}

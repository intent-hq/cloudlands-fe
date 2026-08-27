/**
 * Refresh the adopted local daemon's version info from a `client.hello`
 * result (intent-hq/monorepo#3448).
 *
 * The startup adoption probe (`startIntentdSidecar`) latches
 * `daemonVersionInfo` once, so after the external daemon restarts with a new
 * version the transport payload keeps broadcasting stale daemon build info.
 * The `client.hello` handshake re-runs on every (re)connect and its result
 * carries the live daemon version and optional build commit (`server.version`
 * and `server.buildCommit`, PROTOCOL §5.17) — this helper recomputes the info
 * from it. Extracted from `backend.ipc.ts` so the gating + parse logic is
 * testable without the Electron module graph.
 *
 * Returns the refreshed {@link DaemonVersionInfo}, or `null` when the stored
 * info must be left unchanged:
 *   - the live client is not the LOCAL backend (a remote's hello must never
 *     overwrite the local daemon's info),
 *   - the transport is not UDS or the connection mode is not `external`
 *     (`formatTransportInfo` only reports `daemonVersion` for external-uds),
 *   - the hello result lacks a well-formed `server.version` (fail-safe),
 *   - the recomputed info equals `current` (nothing to update or broadcast).
 */
import { compareToPinnedVersion } from '$shared/intentd-version-compare';
import type { ConnectionMode, DaemonVersionInfo } from './connection-mode';

/** Inputs for {@link computeDaemonVersionRefresh}. */
export interface DaemonVersionRefreshArgs {
  /** The raw `client.hello` result (untrusted shape). */
  helloResult: unknown;
  /** True when the live client is the local backend (`activeConnectionMeta === null`). */
  isLocalBackend: boolean;
  /** The live client's transport discriminator. */
  transport: 'uds' | 'tcp' | 'ws' | 'wss';
  /** The resolved connection mode (see `connection-mode.ts`). */
  connectionMode: ConnectionMode;
  /** The bundled intentd.version pin, or null when unreadable. */
  pinnedVersion: string | null;
  /** The currently stored version info, for the no-change short-circuit. */
  current: DaemonVersionInfo | null;
}

/**
 * Compute the refreshed daemon version info from a hello result, or `null`
 * when the stored info must be left unchanged (see module doc).
 */
export function computeDaemonVersionRefresh(
  args: DaemonVersionRefreshArgs,
): DaemonVersionInfo | null {
  const { helloResult, isLocalBackend, transport, connectionMode, pinnedVersion, current } = args;
  if (!isLocalBackend || transport !== 'uds' || connectionMode !== 'external') return null;
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
  // Same computation as the startup adoption probe: an unparsable/missing
  // side compares 'unknown', which is warn-nothing (versionMismatch false).
  const comparison = pinnedVersion ? compareToPinnedVersion(version, pinnedVersion) : 'unknown';
  const refreshed: DaemonVersionInfo = {
    daemonVersion: version,
    ...(typeof buildCommit === 'string' && buildCommit.length > 0
      ? { daemonBuildCommit: buildCommit }
      : {}),
    pinnedVersion,
    versionMismatch: comparison === 'older' || comparison === 'newer',
  };
  if (
    current &&
    current.daemonVersion === refreshed.daemonVersion &&
    current.daemonBuildCommit === refreshed.daemonBuildCommit &&
    current.pinnedVersion === refreshed.pinnedVersion &&
    current.versionMismatch === refreshed.versionMismatch
  ) {
    return null;
  }
  return refreshed;
}

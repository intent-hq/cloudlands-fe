/**
 * Shared loopback URL resolution: rewrite → reachability probe → tunnel
 * fallback (intent-hq/monorepo#2323).
 *
 * Extracted from `browser-action-executor.ts` so the same resolution backs
 * both `browser.exec` navigate/openTab and the renderer-facing
 * `browser:resolve-url` IPC (programmatic UI entry points: script URL and
 * terminal link clicks — never the address bar, which loads literally per
 * intent-hq/monorepo#2404). Pure of Electron imports; callers inject the
 * loopback context and the tunnel provider.
 */

import { Logger } from '../../../shared/logger';
import {
  classifyLoopbackHost,
  rewriteLoopbackUrl,
  type LoopbackRewriteContext,
  type LoopbackRewriteResult,
} from './loopback-rewrite';

const logger = new Logger('LoopbackUrlResolver');

/** Timeout for the remote-rewrite reachability probe. */
export const REMOTE_REWRITE_PROBE_TIMEOUT_MS = 1500;

/**
 * Minimal tunnel surface the resolver and the `browser.exec` tunnel actions
 * need: `TunnelManager` (`features/backend/main/tunnel-manager.ts`, remote
 * `/tunnel` mux) and `DirectRelay` (`features/backend/main/direct-relay.ts`,
 * local transports) both satisfy it, and tests inject a mock so the resolver
 * stays testable without a real `/tunnel` WebSocket.
 */
export interface TunnelProvider {
  /** Forward daemon-loopback `remotePort`; resolves with the local port. */
  forwardPort(remotePort: number): Promise<number>;
  /**
   * Active forwards (remote → local port pairs), used to recognize URLs that
   * already point at one of this provider's own tunnel-local listeners.
   * Optional so minimal mocks/providers without forward introspection still
   * satisfy the interface; absent means "no active forwards known".
   */
  activeForwards?(): Array<{ remotePort: number; localPort: number }>;
  /**
   * Close the forward for `remotePort`; true when a forward existed.
   * Optional so minimal mocks satisfy the interface; the `closeTunnel`
   * action reports an error when absent.
   */
  closeForward?(remotePort: number): boolean;
  /**
   * Which backend this provider forwards through: `"tunnel"` (daemon
   * `/tunnel` mux, remote transports) or `"direct"` (FE-side loopback relay,
   * local transports). Echoed in tunnel action results; absent on minimal
   * mocks defaults to `"tunnel"`.
   */
  backend?: 'tunnel' | 'direct';
  /**
   * Hook invoked with the remote port whenever the provider drops a forward
   * itself (e.g. a definitively refused connect/OPEN) or via `closeForward`.
   * Mutable so the ownership wrapper can keep its registry in sync with
   * internal drops; optional so minimal mocks satisfy the interface.
   */
  onForwardDropped?: ((remotePort: number) => void) | null;
}

/** Outcome of {@link resolveRewrittenRemoteTarget}. */
export interface RemoteTargetResolution {
  /** Rewrite whose `url`/`reason` reflect the tunnel forward when tunneled. */
  rewrite: LoopbackRewriteResult;
  /** True when the URL was redirected through a daemon tunnel forward. */
  tunneled: boolean;
  /** Explanatory agent-facing error when unreachable and not tunnelable. */
  error?: string;
}

/**
 * Detect a bare-loopback requested URL that already points at one of our own
 * active tunnel-local forwards, and pass it through untouched. Re-resolving
 * such a URL would rewrite it to the daemon host — where the ephemeral
 * forward port does not exist — fail the probe, and mint a dead second-hop
 * tunnel (intent-hq/monorepo#2404). This covers the executor→renderer
 * openTab/navigate handoff (the EmbeddedBrowser re-resolves the executor's
 * already-tunneled URL) and a user pasting a tunnel URL into the address
 * bar. Explicit `daemon.localhost` URLs are never passed through: they name
 * the daemon machine, even if the port coincides with a local forward.
 */
function findTunnelLocalPassthrough(
  rewrite: LoopbackRewriteResult,
  getTunnelProvider?: () => TunnelProvider | null,
): RemoteTargetResolution | null {
  if (rewrite.requestedUrl === undefined) return null;
  let requested: URL;
  try {
    requested = new URL(rewrite.requestedUrl);
  } catch {
    return null;
  }
  if (classifyLoopbackHost(requested.hostname) !== 'bare-loopback' || !requested.port) return null;
  const port = Number(requested.port);
  // The getter may lazily construct the provider; failures mean "no known
  // forwards", never a rejected resolution.
  let forwards: Array<{ remotePort: number; localPort: number }>;
  try {
    forwards = getTunnelProvider?.()?.activeForwards?.() ?? [];
  } catch {
    return null;
  }
  const forward = forwards.find((f) => f.localPort === port);
  if (!forward) return null;
  // Residual limitation: if the idle sweep closed this forward between the
  // executor's resolution and a re-resolution, no forward matches anymore and
  // the URL falls through to the ordinary rewrite → probe → tunnel path (the
  // URL does not carry the remote port, so nothing better is possible here).
  //
  // The forward listener binds 127.0.0.1 only and Chromium does not fall back
  // to IPv4 for an explicit IPv6 literal, so an `[::1]` host is normalized to
  // 127.0.0.1 instead of passing through to a listener that does not exist.
  const isIpv6Loopback = requested.hostname === '[::1]' || requested.hostname === '::1';
  logger.info('URL points at an active tunnel-local forward; passing it through', {
    requestedUrl: rewrite.requestedUrl,
    localPort: forward.localPort,
    remotePort: forward.remotePort,
    ipv6Normalized: isIpv6Loopback,
  });
  const forwardNote =
    // i18n-ignore (agent-facing protocol detail, not user-facing)
    `${requested.hostname}:${port} is this machine's active daemon-tunnel forward for remote ` +
    // i18n-ignore (agent-facing protocol detail, not user-facing)
    `port ${forward.remotePort}`;
  if (isIpv6Loopback) {
    const normalized = new URL(rewrite.requestedUrl);
    normalized.hostname = '127.0.0.1';
    return {
      rewrite: {
        url: normalized.toString(),
        rewritten: true,
        requestedUrl: rewrite.requestedUrl,
        reason:
          // i18n-ignore (agent-facing protocol detail, not user-facing)
          `${forwardNote}, which listens on 127.0.0.1 only; hostname normalized to 127.0.0.1`,
      },
      tunneled: false,
    };
  }
  return {
    rewrite: {
      url: rewrite.requestedUrl,
      rewritten: false,
      // i18n-ignore (agent-facing protocol detail, not user-facing)
      reason: `${forwardNote}; the URL is already resolved and passed through untouched`,
    },
    tunneled: false,
  };
}

/**
 * Probe the origin of a URL that was rewritten to the REMOTE daemon host
 * before navigating to it. Any HTTP response (including error statuses)
 * proves the host:port is reachable from this machine; only a network-level
 * failure (connection refused, unroutable, timeout) fails the probe. URLs
 * that were not rewritten to a remote host are never probed.
 *
 * A requested URL already pointing at one of our own active tunnel-local
 * forwards is passed through untouched instead of being probed/re-tunneled
 * (intent-hq/monorepo#2404).
 *
 * On probe failure, falls back to forwarding the port over the daemon's
 * `/tunnel` WebSocket when a tunnel provider is available (Electron main):
 * the returned rewrite then targets `http(s)://127.0.0.1:<localPort>` and is
 * flagged `tunneled`. Without a provider (non-Electron/web contexts, where no
 * local listener is possible) or when the tunnel itself fails, `error`
 * carries the explanatory agent-facing message instead.
 */
export async function resolveRewrittenRemoteTarget(
  rewrite: LoopbackRewriteResult,
  getTunnelProvider?: () => TunnelProvider | null,
): Promise<RemoteTargetResolution> {
  if (!rewrite.rewritten || !rewrite.remoteHost) return { rewrite, tunneled: false };
  const passthrough = findTunnelLocalPassthrough(rewrite, getTunnelProvider);
  if (passthrough) return passthrough;
  const target = new URL(rewrite.url);
  try {
    const response = await fetch(target.origin, {
      signal: AbortSignal.timeout(REMOTE_REWRITE_PROBE_TIMEOUT_MS),
    });
    // Only reachability matters — cancel the body so undici releases the
    // connection instead of holding it until GC.
    void response.body?.cancel().catch(() => {});
    return { rewrite, tunneled: false };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.cause instanceof Error
          ? error.cause.message
          : error.message
        : String(error);
    const port = target.port || (target.protocol === 'https:' ? '443' : '80');
    logger.warn('Reachability probe failed for rewritten remote URL', {
      requestedUrl: rewrite.requestedUrl,
      rewrittenUrl: rewrite.url,
      origin: target.origin,
      detail,
    });

    // The getter may lazily construct the provider; a construction failure
    // must degrade to the best-effort error result below, not reject.
    let tunnel: TunnelProvider | null = null;
    try {
      tunnel = getTunnelProvider?.() ?? null;
    } catch (providerError) {
      logger.warn('Tunnel provider unavailable for rewritten remote URL', {
        requestedUrl: rewrite.requestedUrl,
        rewrittenUrl: rewrite.url,
        error: providerError instanceof Error ? providerError.message : String(providerError),
      });
    }
    if (tunnel) {
      try {
        const remotePort = Number(port);
        // forwardPort is idempotent on both real providers (TunnelManager,
        // DirectRelay): a repeat call for an already-forwarded remote port
        // returns the existing forward's local port, so repeat resolutions of
        // the same requested URL yield an identical final URL and openTab's
        // exact-URL dedupe can match (intent-hq/monorepo#2787). Always call
        // it — never shortcut via activeForwards — so the ownership wrapper
        // seam records the requesting workspace as a co-owner of the forward
        // (refcounted cleanup, cloudlands-fe#1325).
        const localPort = await tunnel.forwardPort(remotePort);
        // Known limitation: an `https` URL keeps its scheme with the host
        // swapped to 127.0.0.1, so the origin server's cert fails hostname
        // verification in the embedded browser. Nothing better is possible
        // without terminating TLS locally; the practical targets are `http`
        // dev servers.
        const tunneledUrl = new URL(rewrite.url);
        tunneledUrl.hostname = '127.0.0.1';
        tunneledUrl.port = String(localPort);
        logger.info('Rewritten remote origin unreachable; falling back to the daemon tunnel', {
          requestedUrl: rewrite.requestedUrl,
          rewrittenUrl: rewrite.url,
          remotePort,
          localPort,
        });
        return {
          rewrite: {
            ...rewrite,
            url: tunneledUrl.toString(),
            reason:
              // i18n-ignore (agent-facing protocol detail, not user-facing)
              `${rewrite.reason}; ${target.origin} is not directly reachable from this machine, ` +
              // i18n-ignore (agent-facing protocol detail, not user-facing)
              `so port ${port} is forwarded over the daemon tunnel to 127.0.0.1:${localPort}`,
          },
          tunneled: true,
        };
      } catch (tunnelError) {
        logger.warn('Tunnel fallback failed for rewritten remote URL', {
          requestedUrl: rewrite.requestedUrl,
          rewrittenUrl: rewrite.url,
          remotePort: Number(port),
          error: tunnelError instanceof Error ? tunnelError.message : String(tunnelError),
        });
      }
    }

    return {
      rewrite,
      tunneled: false,
      error:
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `The requested URL ${rewrite.requestedUrl} was rewritten to ${rewrite.url} because the daemon runs on a remote machine, ` +
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `but ${target.origin} is not reachable from this machine (probe failed within ${REMOTE_REWRITE_PROBE_TIMEOUT_MS}ms: ${detail}). ` +
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `The server on the daemon machine is likely listening on 127.0.0.1 only — it must bind 0.0.0.0 to accept remote ` +
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `connections — or a firewall is blocking port ${port}.`,
    };
  }
}

/**
 * Result of {@link resolveBrowserUrl}, the flat shape returned over the
 * `browser:resolve-url` IPC. `url` is always loadable-or-best-effort: on a
 * probe+tunnel failure it carries the original rewritten URL alongside the
 * structured `error` (the caller decides how to surface it).
 */
export interface ResolvedBrowserUrl {
  /** Final URL to load (the rewritten URL even when `error` is set). */
  url: string;
  rewritten: boolean;
  /** Original URL as requested; present only when `rewritten` is true. */
  requestedUrl?: string;
  /** Why the URL was (or could not be) rewritten/tunneled. */
  reason?: string;
  /** True when the URL was redirected through a daemon tunnel forward. */
  tunneled?: boolean;
  /** Ambiguity warning for bare-loopback rewrites in remote mode. */
  warning?: string;
  /** Explanatory error when the remote target is unreachable and not tunnelable. */
  error?: string;
}

/** Options for {@link resolveBrowserUrl}. */
export interface ResolveBrowserUrlOptions {
  /**
   * Apply the loopback rewrite only — NO reachability probe and NO tunnel.
   * For display-only callers (e.g. the script detected-URL chip) that need
   * to show where a link points without side effects.
   */
  rewriteOnly?: boolean;
}

/**
 * Full rewrite → probe → tunnel resolution for a single URL. Never throws:
 * unparseable URLs pass through non-rewritten, and probe/tunnel failures are
 * reported via `error` while `url` keeps the rewritten target. With
 * `rewriteOnly` the probe/tunnel stage is skipped entirely (display-only).
 */
export async function resolveBrowserUrl(
  rawUrl: string,
  context: LoopbackRewriteContext,
  getTunnelProvider?: () => TunnelProvider | null,
  options?: ResolveBrowserUrlOptions,
): Promise<ResolvedBrowserUrl> {
  const rewrite = rewriteLoopbackUrl(rawUrl, context);
  const resolution: RemoteTargetResolution = options?.rewriteOnly
    ? { rewrite, tunneled: false }
    : await resolveRewrittenRemoteTarget(rewrite, getTunnelProvider);
  const finalRewrite = resolution.rewrite;
  return {
    url: finalRewrite.url,
    rewritten: finalRewrite.rewritten,
    ...(finalRewrite.requestedUrl !== undefined ? { requestedUrl: finalRewrite.requestedUrl } : {}),
    ...(finalRewrite.reason !== undefined ? { reason: finalRewrite.reason } : {}),
    ...(resolution.tunneled ? { tunneled: true } : {}),
    ...(finalRewrite.warning !== undefined ? { warning: finalRewrite.warning } : {}),
    ...(resolution.error !== undefined ? { error: resolution.error } : {}),
  };
}

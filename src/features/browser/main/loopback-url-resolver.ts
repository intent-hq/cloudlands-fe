/**
 * Shared loopback URL resolution: rewrite → reachability probe → tunnel
 * fallback (intent-hq/monorepo#2323).
 *
 * Extracted from `browser-action-executor.ts` so the same resolution backs
 * both `browser.exec` navigate/openTab and the renderer-facing
 * `browser:resolve-url` IPC (UI navigations: script URLs, terminal links,
 * address bar). Pure of Electron imports; callers inject the loopback
 * context and the tunnel provider.
 */

import { Logger } from '../../../shared/logger';
import {
  rewriteLoopbackUrl,
  type LoopbackRewriteContext,
  type LoopbackRewriteResult,
} from './loopback-rewrite';

const logger = new Logger('LoopbackUrlResolver');

/** Timeout for the remote-rewrite reachability probe. */
export const REMOTE_REWRITE_PROBE_TIMEOUT_MS = 1500;

/**
 * Minimal tunnel surface the resolver needs for the probe-failure fallback:
 * `TunnelManager` (`features/backend/main/tunnel-manager.ts`) satisfies it,
 * and tests inject a mock so the resolver stays testable without a real
 * `/tunnel` WebSocket.
 */
export interface TunnelProvider {
  /** Forward daemon-loopback `remotePort`; resolves with the local port. */
  forwardPort(remotePort: number): Promise<number>;
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
 * Probe the origin of a URL that was rewritten to the REMOTE daemon host
 * before navigating to it. Any HTTP response (including error statuses)
 * proves the host:port is reachable from this machine; only a network-level
 * failure (connection refused, unroutable, timeout) fails the probe. URLs
 * that were not rewritten to a remote host are never probed.
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
        const localPort = await tunnel.forwardPort(Number(port));
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
          remotePort: Number(port),
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

/**
 * Full rewrite → probe → tunnel resolution for a single URL. Never throws:
 * unparseable URLs pass through non-rewritten, and probe/tunnel failures are
 * reported via `error` while `url` keeps the rewritten target.
 */
export async function resolveBrowserUrl(
  rawUrl: string,
  context: LoopbackRewriteContext,
  getTunnelProvider?: () => TunnelProvider | null,
): Promise<ResolvedBrowserUrl> {
  const rewrite = rewriteLoopbackUrl(rawUrl, context);
  const resolution = await resolveRewrittenRemoteTarget(rewrite, getTunnelProvider);
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

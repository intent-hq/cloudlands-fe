/**
 * Pure loopback-hostname classification + rewrite for `browser.exec`
 * `navigate`/`openTab` URLs (intent-hq/monorepo#2323).
 *
 * Reserved hostnames (Docker's `host.docker.internal` pattern, RFC 6761
 * `*.localhost` names so a missed rewrite still degrades to loopback):
 *
 * | Hostname                              | Local setup        | Remote setup                    |
 * |---------------------------------------|--------------------|---------------------------------|
 * | `daemon.localhost`                    | → `127.0.0.1`      | → daemon host                   |
 * | `client.localhost`                    | → `127.0.0.1`      | → `127.0.0.1`                   |
 * | bare `127.0.0.1` / `localhost` / `[::1]` | unchanged       | → daemon host + ambiguity warning |
 * | anything else                         | unchanged          | unchanged                       |
 *
 * Only the hostname is rewritten — scheme, port, path, query, and hash are
 * preserved. This module is pure (no Electron/transport imports); the executor
 * wiring supplies `{ daemonIsRemote, daemonHost }` from transport state.
 */

export const DAEMON_LOCALHOST = 'daemon.localhost';
export const CLIENT_LOCALHOST = 'client.localhost';

/** Classification of a URL hostname for loopback rewriting. */
export type LoopbackHostKind = 'daemon-alias' | 'client-alias' | 'bare-loopback' | 'other';

export interface LoopbackRewriteContext {
  /** True when the active daemon connection targets another machine. */
  daemonIsRemote: boolean;
  /** Hostname the FE uses to reach the remote daemon (sanitized transport target). */
  daemonHost?: string;
}

export interface LoopbackRewriteResult {
  /** Final URL to load (equals the input when `rewritten` is false). */
  url: string;
  rewritten: boolean;
  /** Original URL as requested; present only when `rewritten` is true. */
  requestedUrl?: string;
  /** Why the URL was (or could not be) rewritten. */
  reason?: string;
  /** Ambiguity warning for bare-loopback rewrites in remote mode. */
  warning?: string;
}

/**
 * Classify a URL hostname (as returned by `new URL(...).hostname`, i.e.
 * already lowercased; IPv6 may appear with or without brackets).
 */
export function classifyLoopbackHost(hostname: string): LoopbackHostKind {
  const host = hostname.toLowerCase();
  if (host === DAEMON_LOCALHOST) return 'daemon-alias';
  if (host === CLIENT_LOCALHOST) return 'client-alias';
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') {
    return 'bare-loopback';
  }
  return 'other';
}

/** IPv6 daemon hosts must be bracketed before assignment to `URL.hostname`. */
function toUrlHostname(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function withHostname(url: URL, hostname: string): string {
  const next = new URL(url.href);
  next.hostname = toUrlHostname(hostname);
  return next.href;
}

/**
 * Rewrite a `navigate`/`openTab` URL per the loopback-hostname table.
 * Never throws: unparseable URLs and missing context degrade to a
 * non-rewritten result with an explanatory `reason`.
 */
export function rewriteLoopbackUrl(
  rawUrl: string,
  context: LoopbackRewriteContext,
): LoopbackRewriteResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { url: rawUrl, rewritten: false, reason: `not a parseable URL: ${rawUrl}` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { url: rawUrl, rewritten: false };
  }

  const kind = classifyLoopbackHost(url.hostname);
  if (kind === 'other') {
    return { url: rawUrl, rewritten: false };
  }

  const { daemonIsRemote, daemonHost } = context;

  if (kind === 'client-alias') {
    return {
      url: withHostname(url, '127.0.0.1'),
      rewritten: true,
      requestedUrl: rawUrl,
      reason: `${CLIENT_LOCALHOST} targets the client machine; rewritten to 127.0.0.1`,
    };
  }

  if (kind === 'daemon-alias') {
    if (!daemonIsRemote) {
      return {
        url: withHostname(url, '127.0.0.1'),
        rewritten: true,
        requestedUrl: rawUrl,
        reason: `${DAEMON_LOCALHOST} targets the daemon machine; daemon is local, rewritten to 127.0.0.1`,
      };
    }
    if (!daemonHost) {
      return {
        url: rawUrl,
        rewritten: false,
        reason: `${DAEMON_LOCALHOST} targets the remote daemon machine, but its host is unknown; URL left unchanged`,
      };
    }
    return {
      url: withHostname(url, daemonHost),
      rewritten: true,
      requestedUrl: rawUrl,
      reason: `${DAEMON_LOCALHOST} targets the daemon machine; rewritten to remote daemon host ${daemonHost}`,
    };
  }

  // bare-loopback: unchanged locally; assumed daemon-local in remote mode.
  if (!daemonIsRemote) {
    return { url: rawUrl, rewritten: false };
  }
  if (!daemonHost) {
    return {
      url: rawUrl,
      rewritten: false,
      reason: `bare loopback URL assumed daemon-local, but the remote daemon host is unknown; URL left unchanged`,
    };
  }
  return {
    url: withHostname(url, daemonHost),
    rewritten: true,
    requestedUrl: rawUrl,
    reason: `bare loopback URL assumed daemon-local; rewritten to remote daemon host ${daemonHost}`,
    warning:
      `Loopback host "${url.hostname}" was assumed to mean the daemon machine and rewritten to ` +
      `${daemonHost}. Use http(s)://${DAEMON_LOCALHOST} to target the daemon machine explicitly, or ` +
      `http(s)://${CLIENT_LOCALHOST} to target the user's machine.`,
  };
}

/**
 * Request checks for Browser access (the desktop app serving the web UI to a
 * browser through a front-end such as `tailscale serve`).
 *
 * The server listens on a loopback port, so every local process and every
 * front-end the user configures can reach it. It therefore never trusts
 * identity headers: each request must carry a session cookie derived from the
 * user's access key, and browser-level attacks are blocked separately:
 * - DNS rebinding: the Host header must be loopback or the front-end's
 *   forwarded host, and a rebound page never carries this host's cookie.
 * - Cross-site WebSocket hijacking: the upgrade's Origin must equal the page
 *   origin the front-end reports (X-Forwarded-Proto/Host), else Host.
 *
 * Everything here is pure so it can be tested without Electron.
 */
import crypto from 'node:crypto';

/**
 * Cookie that older versions issued. Browsers keep cookies per host name, not
 * per port, so every server on one host shared it and signing in to one signed
 * out the others. It is still accepted, and replaced on the next page load.
 */
export const SESSION_COOKIE = 'intent_browser_access';
/** Prefix of the per-server cookie (see sessionCookieName). */
const SESSION_COOKIE_PREFIX = 'intent_session_';
/** Idle lifetime: the browser maximum (400 days). Active sessions slide. */
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** A session cookie is renewed at most this often. */
const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
/** Tolerated clock skew for a cookie's issue time. */
const SESSION_FUTURE_SKEW_SECONDS = 5 * 60;
/** Backend ids accepted in URLs (connection ids are UUIDs; `local` is reserved). */
export const CONNECTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const SESSION_CONTEXT = 'intent-browser-access-session-v1';
const SESSION_V2_CONTEXT = 'intent-browser-access-session-v2';
const COOKIE_NAME_CONTEXT = 'intent-browser-access-cookie-name-v1';

type Headers = Record<string, string | string[] | undefined>;

/** A new random access key (256 bits, URL-safe). */
export function generateAccessKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** The legacy cookie value for an access key (accepted, never issued). */
export function deriveSessionToken(accessKey: string): string {
  return crypto.createHmac('sha256', accessKey).update(SESSION_CONTEXT).digest('base64url');
}

function timingSafeEqualText(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right) && a.length === b.length;
}

/** Whether a user-supplied key matches the configured access key. */
export function accessKeyMatches(candidate: unknown, accessKey: string): boolean {
  return (
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    timingSafeEqualText(candidate.trim(), accessKey)
  );
}

/** Parse a Cookie header into name/value pairs (first occurrence wins). */
export function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  const text = Array.isArray(header) ? header.join('; ') : (header ?? '');
  for (const part of text.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || cookies.has(name)) continue;
    cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

/**
 * This server's session cookie name. It is derived from the access key, so two
 * servers on one host name (different ports, or the desktop app and
 * intent-web) never overwrite each other's sessions.
 */
export function sessionCookieName(accessKey: string): string {
  const id = crypto
    .createHmac('sha256', accessKey)
    .update(COOKIE_NAME_CONTEXT)
    .digest('base64url')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12);
  return `${SESSION_COOKIE_PREFIX}${id}`;
}

function sessionMac(accessKey: string, issuedAt: number): string {
  return crypto
    .createHmac('sha256', accessKey)
    .update(`${SESSION_V2_CONTEXT}|${issuedAt}`)
    .digest('base64url');
}

/** The cookie value for a session issued at `issuedAt` (Unix seconds). */
export function sessionCookieValue(accessKey: string, issuedAt: number): string {
  return `${issuedAt.toString(36)}.${sessionMac(accessKey, issuedAt)}`;
}

/** What the request's cookies say about its session. */
export interface SessionCheck {
  readonly valid: boolean;
  /** Valid, and old or legacy enough that the next page load should renew it. */
  readonly renew: boolean;
}

const NO_SESSION: SessionCheck = { valid: false, renew: false };

/**
 * Check the session cookie. A session is valid while its issue time, signed
 * with the current access key, is less than SESSION_MAX_AGE_SECONDS old.
 * Resetting the key invalidates every session at once.
 */
export function checkSession(
  headers: Headers,
  accessKey: string,
  nowMs: number = Date.now(),
): SessionCheck {
  const cookies = parseCookies(headers.cookie);
  const now = Math.floor(nowMs / 1000);
  const value = cookies.get(sessionCookieName(accessKey));
  if (typeof value === 'string') {
    const match = /^([0-9a-z]{1,10})\.([A-Za-z0-9_-]{43})$/.exec(value);
    const issuedAt = match ? parseInt(match[1], 36) : NaN;
    if (
      match &&
      Number.isSafeInteger(issuedAt) &&
      issuedAt <= now + SESSION_FUTURE_SKEW_SECONDS &&
      now - issuedAt < SESSION_MAX_AGE_SECONDS &&
      timingSafeEqualText(match[2], sessionMac(accessKey, issuedAt))
    ) {
      return { valid: true, renew: now - issuedAt >= SESSION_RENEW_AFTER_SECONDS };
    }
  }
  const legacy = cookies.get(SESSION_COOKIE);
  if (typeof legacy === 'string' && timingSafeEqualText(legacy, deriveSessionToken(accessKey))) {
    return { valid: true, renew: true };
  }
  return NO_SESSION;
}

/** Whether the request carries a valid session cookie for this access key. */
export function hasValidSession(headers: Headers, accessKey: string): boolean {
  return checkSession(headers, accessKey).valid;
}

/**
 * `Set-Cookie` value establishing (or renewing) a session that lasts
 * SESSION_MAX_AGE_SECONDS from now. `Secure` whenever the page is https.
 */
export function sessionCookieHeader(
  accessKey: string,
  secure: boolean,
  nowMs: number = Date.now(),
): string {
  return [
    `${sessionCookieName(accessKey)}=${sessionCookieValue(accessKey, Math.floor(nowMs / 1000))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string') return undefined;
  const first = text.split(',')[0]?.trim();
  return first || undefined;
}

function hostnameOf(host: string): string | null {
  try {
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a Host header names this machine's loopback interface. */
export function isLoopbackHost(host: string | string[] | undefined): boolean {
  const value = firstHeaderValue(host);
  if (!value) return false;
  const hostname = hostnameOf(value);
  if (!hostname) return false;
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127(?:\.[0-9]{1,3}){3}$/.test(hostname)
  );
}

/**
 * Whether the Host header is acceptable: a loopback name (a direct visit), or
 * the same name a front-end reports in X-Forwarded-Host (`tailscale serve`
 * forwards the public name as both). The session cookie remains the real gate:
 * a DNS-rebinding page can forge these headers but never has this host's cookie.
 */
export function isAllowedHost(headers: Headers): boolean {
  if (isLoopbackHost(headers.host)) return true;
  const host = firstHeaderValue(headers.host)?.toLowerCase();
  const forwarded = firstHeaderValue(headers['x-forwarded-host'])?.toLowerCase();
  return Boolean(host && forwarded && host === forwarded && hostnameOf(host));
}

/**
 * The origin the browser's page is on. A front-end such as `tailscale serve`
 * reports it in X-Forwarded-Proto/Host; a direct loopback visit uses Host.
 * Returns null when the headers do not form a plain origin.
 */
export function pageOrigin(headers: Headers): string | null {
  const forwardedHost = firstHeaderValue(headers['x-forwarded-host']);
  const host = forwardedHost ?? firstHeaderValue(headers.host);
  if (!host || !hostnameOf(host)) return null;
  const forwardedProto = firstHeaderValue(headers['x-forwarded-proto'])?.toLowerCase();
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Which page origin to remember for sign-in links: the latest one, except that
 * a loopback visit never replaces a front-end address seen before.
 */
export function preferredPageOrigin(previous: string | null, next: string | null): string | null {
  if (!next) return previous;
  if (previous && !isLoopbackHost(new URL(previous).host) && isLoopbackHost(new URL(next).host))
    return previous;
  return next;
}

/** Whether a WebSocket upgrade comes from the page this server served. */
export function isSameOriginUpgrade(headers: Headers): boolean {
  const origin = firstHeaderValue(headers.origin);
  const expected = pageOrigin(headers);
  return Boolean(origin && expected && origin.toLowerCase() === expected.toLowerCase());
}

/**
 * Global limit on failed key attempts. Browser access serves one person, so a
 * single shared budget is enough and also bounds distributed guessing.
 */
export class LoginRateLimiter {
  private failures: number[] = [];

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when another attempt may be checked right now. */
  allow(): boolean {
    const cutoff = this.now() - this.windowMs;
    this.failures = this.failures.filter((time) => time > cutoff);
    return this.failures.length < this.maxFailures;
  }

  recordFailure(): void {
    this.failures.push(this.now());
  }

  /**
   * Count an attempt as a failure before checking it, so parallel attempts
   * cannot all pass `allow()` while their checks are still running. Returns a
   * refund to call if the attempt succeeds, or null when the budget is spent.
   */
  reserve(): (() => void) | null {
    if (!this.allow()) return null;
    const time = this.now();
    this.failures.push(time);
    return () => {
      const index = this.failures.indexOf(time);
      if (index !== -1) this.failures.splice(index, 1);
    };
  }
}

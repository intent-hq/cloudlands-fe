/**
 * Request checks for Browser access (the desktop app serving the web UI to a
 * browser through a front-end such as `tailscale serve`).
 *
 * The server listens on a loopback port, so every local process and every
 * front-end the user configures can reach it. It therefore never trusts
 * identity headers: each request must carry a session cookie derived from the
 * user's access key, and browser-level attacks are blocked separately:
 * - DNS rebinding: the Host header must name a loopback address.
 * - Cross-site WebSocket hijacking: the upgrade's Origin must equal the page
 *   origin the front-end reports (X-Forwarded-Proto/Host), else Host.
 *
 * Everything here is pure so it can be tested without Electron.
 */
import crypto from 'node:crypto';

/** Cookie holding the session token. */
export const SESSION_COOKIE = 'intent_browser_access';
/** Session lifetime; resetting the access key revokes sessions sooner. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** Backend ids accepted in URLs (connection ids are UUIDs; `local` is reserved). */
export const CONNECTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const SESSION_CONTEXT = 'intent-browser-access-session-v1';

type Headers = Record<string, string | string[] | undefined>;

/** A new random access key (256 bits, URL-safe). */
export function generateAccessKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** The cookie value for an access key. Stable across restarts; changes when the key does. */
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

/** Whether the request carries a valid session cookie for this access key. */
export function hasValidSession(headers: Headers, accessKey: string): boolean {
  const token = parseCookies(headers.cookie).get(SESSION_COOKIE);
  return typeof token === 'string' && timingSafeEqualText(token, deriveSessionToken(accessKey));
}

/** `Set-Cookie` value establishing a session. `Secure` whenever the page is https. */
export function sessionCookieHeader(accessKey: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${deriveSessionToken(accessKey)}`,
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
}

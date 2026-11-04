/**
 * Short-lived sign-in for Intent Web, without typing the access key on the
 * browser that signs in.
 *
 * - QR sign-in: the sign-in page of a browser that is not signed in starts a
 *   pending request. Its QR code opens an approve page on another device (a
 *   phone), where the user enters the access key. The waiting browser then
 *   claims a session. The request secret stays in that browser's HttpOnly
 *   cookie; the QR carries only the approve code. A match code shown on both
 *   screens lets the user check that they approve their own browser.
 * - One-time links: `intent-web link` signs a token with the access key, so the
 *   CLI and the server share no state. The server remembers used nonces until
 *   they expire, so each link signs in one browser once.
 *
 * Every request and token is bound to the access key it was made with, so a
 * key reset invalidates all of them. Everything here is pure (injected clock)
 * so it can be tested without a server.
 */
import crypto from 'node:crypto';

import { deriveSessionToken } from './browser-access-auth';

/** How long a QR sign-in request waits for approval. */
export const DEVICE_LOGIN_TTL_MS = 2 * 60_000;
/** Most pending QR requests kept at once; the oldest is dropped first. */
const MAX_PENDING_DEVICE_LOGINS = 32;
/** Default and maximum lifetime of a one-time link, in minutes. */
export const LINK_DEFAULT_TTL_MINUTES = 5;
export const LINK_MAX_TTL_MINUTES = 15;

const LINK_CONTEXT = 'intent-web-link-v1';
const LINK_PATTERN = /^v1\.([0-9]{1,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
/** Unambiguous characters for the match code (no 0/O, 1/I/L). */
const MATCH_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const MATCH_LENGTH = 6;

function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sameText(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right) && a.length === b.length;
}

/** A 6-character code, shown as `ABC-DEF`. */
function matchCode(): string {
  let code = '';
  for (let i = 0; i < MATCH_LENGTH; i++)
    code += MATCH_ALPHABET[crypto.randomInt(MATCH_ALPHABET.length)];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

interface PendingRequest {
  readonly secret: string;
  readonly approveCode: string;
  readonly matchCode: string;
  readonly keyTag: string;
  readonly expiresAt: number;
  approved: boolean;
}

export interface DeviceLoginRequest {
  /** Held only by the waiting browser (HttpOnly cookie). */
  readonly secret: string;
  /** Goes in the QR link. */
  readonly approveCode: string;
  /** Shown on both screens. */
  readonly matchCode: string;
  readonly expiresAt: number;
}

function publicView(request: PendingRequest): DeviceLoginRequest {
  const { secret, approveCode, matchCode: code, expiresAt } = request;
  return { secret, approveCode, matchCode: code, expiresAt };
}

export type ClaimResult = 'approved' | 'pending' | 'expired';

export class DeviceLoginStore {
  private readonly requests = new Map<string, PendingRequest>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEVICE_LOGIN_TTL_MS,
    private readonly maxPending = MAX_PENDING_DEVICE_LOGINS,
  ) {}

  private prune(): void {
    const now = this.now();
    for (const [secret, request] of this.requests)
      if (request.expiresAt <= now) this.requests.delete(secret);
  }

  private live(request: PendingRequest | undefined, accessKey: string): PendingRequest | null {
    if (!request) return null;
    if (request.expiresAt <= this.now() || request.keyTag !== deriveSessionToken(accessKey)) {
      this.requests.delete(request.secret);
      return null;
    }
    return request;
  }

  private bySecret(secret: unknown): PendingRequest | undefined {
    if (typeof secret !== 'string' || !secret) return undefined;
    for (const [stored, request] of this.requests) if (sameText(stored, secret)) return request;
    return undefined;
  }

  /** Start a pending request for the current access key. */
  create(accessKey: string): DeviceLoginRequest {
    this.prune();
    while (this.requests.size >= this.maxPending) {
      const oldest = this.requests.keys().next().value;
      if (oldest === undefined) break;
      this.requests.delete(oldest);
    }
    const request: PendingRequest = {
      secret: randomToken(32),
      approveCode: randomToken(16),
      matchCode: matchCode(),
      keyTag: deriveSessionToken(accessKey),
      expiresAt: this.now() + this.ttlMs,
      approved: false,
    };
    this.requests.set(request.secret, request);
    return publicView(request);
  }

  /** The live, unapproved request a browser already waits on (reused across reloads). */
  pending(secret: unknown, accessKey: string): DeviceLoginRequest | null {
    const request = this.live(this.bySecret(secret), accessKey);
    return request && !request.approved ? publicView(request) : null;
  }

  /** The match code for an approve link, or null when it is unknown, used or expired. */
  lookup(approveCode: unknown, accessKey: string): { matchCode: string } | null {
    if (typeof approveCode !== 'string' || !approveCode) return null;
    for (const request of this.requests.values()) {
      if (!sameText(request.approveCode, approveCode)) continue;
      const live = this.live(request, accessKey);
      return live && !live.approved ? { matchCode: live.matchCode } : null;
    }
    return null;
  }

  /** Approve a request; the caller has already checked the access key. True once per request. */
  approve(approveCode: unknown, accessKey: string): boolean {
    if (typeof approveCode !== 'string' || !approveCode) return false;
    for (const request of this.requests.values()) {
      if (!sameText(request.approveCode, approveCode)) continue;
      const live = this.live(request, accessKey);
      if (!live || live.approved) return false;
      live.approved = true;
      return true;
    }
    return false;
  }

  /** Poll from the waiting browser. `approved` is returned once; the request is then gone. */
  claim(secret: unknown, accessKey: string): ClaimResult {
    const request = this.live(this.bySecret(secret), accessKey);
    if (!request) return 'expired';
    if (!request.approved) return 'pending';
    this.requests.delete(request.secret);
    return 'approved';
  }

  get size(): number {
    this.prune();
    return this.requests.size;
  }
}

function linkMac(accessKey: string, expiresAt: number, nonce: string): string {
  return crypto
    .createHmac('sha256', accessKey)
    .update(`${LINK_CONTEXT}|${expiresAt}|${nonce}`)
    .digest('base64url');
}

/** A one-time link token, valid for `ttlMinutes` (1 to 15) from `now`. */
export function mintLinkToken(
  accessKey: string,
  ttlMinutes = LINK_DEFAULT_TTL_MINUTES,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > LINK_MAX_TTL_MINUTES)
    throw new Error(`Link lifetime must be 1 to ${LINK_MAX_TTL_MINUTES} minutes`);
  const expiresAt = Math.floor(now / 1000) + ttlMinutes * 60;
  const nonce = randomToken(16);
  return {
    token: `v1.${expiresAt}.${nonce}.${linkMac(accessKey, expiresAt, nonce)}`,
    expiresAt: expiresAt * 1000,
  };
}

/** Checks one-time link tokens and remembers used ones until they expire. */
export class LinkTokenVerifier {
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True once for a valid, unexpired token made with the current key. */
  redeem(token: unknown, accessKey: string): boolean {
    if (typeof token !== 'string') return false;
    const match = LINK_PATTERN.exec(token);
    if (!match) return false;
    const [, expiryText, nonce, mac] = match;
    const expiresAt = Number(expiryText);
    const nowSeconds = this.now() / 1000;
    for (const [used, expiry] of this.used) if (expiry <= nowSeconds) this.used.delete(used);
    if (!sameText(mac, linkMac(accessKey, expiresAt, nonce))) return false;
    // Expired, or longer-lived than any link the CLI makes (clock skew aside).
    if (expiresAt <= nowSeconds || expiresAt > nowSeconds + LINK_MAX_TTL_MINUTES * 60 + 60)
      return false;
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt);
    return true;
  }
}

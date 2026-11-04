/**
 * Single-use sign-in codes for Browser access and intent-web: a short code a
 * person types (or opens as a link) instead of the long access key.
 *
 * - 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L), drawn
 *   with crypto randomness: 31^6 ≈ 8.9 × 10^8 values. Shown as `ABC-DEF`;
 *   input is case-insensitive and ignores spaces and hyphens.
 * - Valid once, for SIGN_IN_CODE_TTL_MS, with at most SIGN_IN_CODE_MAX_ACTIVE
 *   unused codes at a time (creating another drops the oldest).
 * - Only an HMAC of the code, keyed by the access key, is stored. Resetting the
 *   key therefore invalidates every code, and a leaked store does not reveal
 *   codes without the key.
 * - Consumption runs inside the store's exclusive update, so two sign-ins with
 *   one code cannot both succeed.
 *
 * Wrong codes count against the same LoginRateLimiter as wrong keys (see the
 * server). Pure apart from the injected store and clock.
 */
import crypto from 'node:crypto';

export const SIGN_IN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SIGN_IN_CODE_LENGTH = 6;
export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000;
export const SIGN_IN_CODE_MAX_ACTIVE = 5;
/** Used or expired codes are remembered this long so the page can say so. */
const SIGN_IN_CODE_RETAIN_MS = 60 * 60 * 1000;
const CODE_HASH_CONTEXT = 'intent-browser-access-sign-in-code-v1';

interface SignInCodeEntry {
  /** HMAC-SHA256 (base64url) of the normalized code, keyed by the access key. */
  readonly hash: string;
  /** Expiry, Unix milliseconds. */
  readonly expiresAt: number;
  /** Set once the code signed someone in. */
  readonly usedAt?: number;
}

/** Everything a host persists for sign-in codes and links. */
export interface SignInState {
  readonly codes: readonly SignInCodeEntry[];
  /** Origin of the page last loaded with a valid session, for building links. */
  readonly pageOrigin: string | null;
}

export const EMPTY_SIGN_IN_STATE: SignInState = { codes: [], pageOrigin: null };

/**
 * Holds SignInState. `update` must run its function exclusively (no other
 * update in this or any other process in between) and persist the result.
 */
export interface SignInStore {
  read(): Promise<SignInState>;
  update<T>(change: (state: SignInState) => { state: SignInState; result: T }): Promise<T>;
}

export type SignInCodeResult = 'ok' | 'used-or-expired' | 'invalid';

interface CreatedSignInCode {
  /** Display form, `ABC-DEF`. */
  readonly code: string;
  /** Unix milliseconds. */
  readonly expiresAt: number;
}

/** A new random code (normalized form, no separator). */
export function generateSignInCode(): string {
  let code = '';
  for (let index = 0; index < SIGN_IN_CODE_LENGTH; index++) {
    code += SIGN_IN_CODE_ALPHABET[crypto.randomInt(SIGN_IN_CODE_ALPHABET.length)];
  }
  return code;
}

/** `ABCDEF` → `ABC-DEF`. */
export function formatSignInCode(code: string): string {
  const half = SIGN_IN_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** The normalized code typed or pasted by a person, or null when it is not one. */
export function normalizeSignInCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== SIGN_IN_CODE_LENGTH) return null;
  for (const char of code) if (!SIGN_IN_CODE_ALPHABET.includes(char)) return null;
  return code;
}

function hashCode(accessKey: string, code: string): string {
  return crypto
    .createHmac('sha256', accessKey)
    .update(`${CODE_HASH_CONTEXT}|${code}`)
    .digest('base64url');
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Drop entries past their retention, then trim unused live codes to the cap (oldest first). */
function prune(codes: readonly SignInCodeEntry[], now: number): SignInCodeEntry[] {
  const kept = codes.filter((entry) => entry.expiresAt + SIGN_IN_CODE_RETAIN_MS > now);
  const active = kept
    .filter((entry) => entry.usedAt === undefined && entry.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt);
  const dropped = new Set(active.slice(0, Math.max(0, active.length - SIGN_IN_CODE_MAX_ACTIVE)));
  return kept.filter((entry) => !dropped.has(entry));
}

/** Parse persisted state, discarding anything malformed. */
export function parseSignInState(value: unknown): SignInState {
  if (!value || typeof value !== 'object') return EMPTY_SIGN_IN_STATE;
  const record = value as { codes?: unknown; pageOrigin?: unknown };
  const codes = Array.isArray(record.codes)
    ? record.codes.filter(
        (entry): entry is SignInCodeEntry =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as SignInCodeEntry).hash === 'string' &&
          Number.isFinite((entry as SignInCodeEntry).expiresAt) &&
          ((entry as SignInCodeEntry).usedAt === undefined ||
            Number.isFinite((entry as SignInCodeEntry).usedAt)),
      )
    : [];
  let pageOrigin: string | null = null;
  if (typeof record.pageOrigin === 'string') {
    try {
      const url = new URL(record.pageOrigin);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.origin === record.pageOrigin
      )
        pageOrigin = url.origin;
    } catch {
      pageOrigin = null;
    }
  }
  return { codes, pageOrigin };
}

/** The sign-in link for a code, or null when no page origin is known. */
export function signInLink(
  pageOrigin: string | null,
  loginPath: string,
  code: string,
): string | null {
  if (!pageOrigin) return null;
  const url = new URL(loginPath, pageOrigin);
  url.searchParams.set('code', code.replace(/-/g, ''));
  return url.toString();
}

export interface SignInCodes {
  create(): Promise<CreatedSignInCode>;
  /** Consume a code typed by a person. Exactly one concurrent caller gets `ok`. */
  consume(input: string): Promise<SignInCodeResult>;
  /** Forget every code (the access key was reset). */
  clear(): Promise<void>;
  pageOrigin(): Promise<string | null>;
  setPageOrigin(origin: string | null): Promise<void>;
}

export function createSignInCodes(options: {
  readonly store: SignInStore;
  readonly getAccessKey: () => string;
  readonly now?: () => number;
}): SignInCodes {
  const now = options.now ?? Date.now;
  return {
    create: () =>
      options.store.update((state) => {
        const time = now();
        const code = generateSignInCode();
        const expiresAt = time + SIGN_IN_CODE_TTL_MS;
        const codes = prune(
          [...state.codes, { hash: hashCode(options.getAccessKey(), code), expiresAt }],
          time,
        );
        return {
          state: { ...state, codes },
          result: { code: formatSignInCode(code), expiresAt },
        };
      }),
    consume: (input) => {
      const code = normalizeSignInCode(input);
      if (!code) return Promise.resolve('invalid');
      return options.store.update<SignInCodeResult>((state) => {
        const time = now();
        const hash = hashCode(options.getAccessKey(), code);
        let result: SignInCodeResult = 'invalid';
        const codes = prune(state.codes, time).map((entry) => {
          if (result !== 'invalid' || !hashesEqual(entry.hash, hash)) return entry;
          if (entry.usedAt !== undefined || entry.expiresAt <= time) {
            result = 'used-or-expired';
            return entry;
          }
          result = 'ok';
          return { ...entry, usedAt: time };
        });
        return { state: { ...state, codes }, result };
      });
    },
    clear: () =>
      options.store.update((state) => ({ state: { ...state, codes: [] }, result: undefined })),
    pageOrigin: async () => (await options.store.read()).pageOrigin,
    setPageOrigin: (origin) =>
      options.store.update((state) => ({
        state: { ...state, pageOrigin: origin },
        result: undefined,
      })),
  };
}

/** A store kept in memory (the desktop app: codes live only while it runs). */
export function createMemorySignInStore(initial: SignInState = EMPTY_SIGN_IN_STATE): SignInStore {
  let state = initial;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    read: async () => state,
    update: <T>(change: (current: SignInState) => { state: SignInState; result: T }) => {
      const run = chain.then(() => {
        const next = change(state);
        state = next.state;
        return next.result;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

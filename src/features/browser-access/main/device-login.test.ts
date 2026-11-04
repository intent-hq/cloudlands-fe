// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DEVICE_LOGIN_TTL_MS,
  DeviceLoginStore,
  LinkTokenVerifier,
  mintLinkToken,
} from './device-login';

const KEY = 'key-one';
const OTHER = 'key-two';

function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe('DeviceLoginStore', () => {
  it('creates distinct requests with a readable match code', () => {
    const store = new DeviceLoginStore();
    const a = store.create(KEY);
    const b = store.create(KEY);
    expect(a.secret).not.toBe(b.secret);
    expect(a.approveCode).not.toBe(a.secret);
    expect(a.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.approveCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.matchCode).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
  });

  it('approves once and lets the waiting browser claim once', () => {
    const store = new DeviceLoginStore();
    const request = store.create(KEY);
    expect(store.lookup(request.approveCode, KEY)).toEqual({ matchCode: request.matchCode });
    expect(store.claim(request.secret, KEY)).toBe('pending');
    expect(store.approve(request.approveCode, KEY)).toBe(true);
    expect(store.approve(request.approveCode, KEY)).toBe(false);
    expect(store.lookup(request.approveCode, KEY)).toBeNull();
    expect(store.claim(request.secret, KEY)).toBe('approved');
    expect(store.claim(request.secret, KEY)).toBe('expired');
  });

  it('does not accept the approve code as the claim secret, or unknown values', () => {
    const store = new DeviceLoginStore();
    const request = store.create(KEY);
    store.approve(request.approveCode, KEY);
    expect(store.claim(request.approveCode, KEY)).toBe('expired');
    expect(store.claim('nope', KEY)).toBe('expired');
    expect(store.claim(undefined, KEY)).toBe('expired');
    expect(store.approve(request.secret, KEY)).toBe(false);
    expect(store.lookup(42, KEY)).toBeNull();
  });

  it('expires requests', () => {
    const time = clock();
    const store = new DeviceLoginStore(time.now);
    const request = store.create(KEY);
    time.advance(DEVICE_LOGIN_TTL_MS);
    expect(store.lookup(request.approveCode, KEY)).toBeNull();
    expect(store.approve(request.approveCode, KEY)).toBe(false);
    expect(store.claim(request.secret, KEY)).toBe('expired');
  });

  it('expires an approved request that is never claimed', () => {
    const time = clock();
    const store = new DeviceLoginStore(time.now);
    const request = store.create(KEY);
    store.approve(request.approveCode, KEY);
    time.advance(DEVICE_LOGIN_TTL_MS);
    expect(store.claim(request.secret, KEY)).toBe('expired');
  });

  it('invalidates requests made with an earlier access key', () => {
    const store = new DeviceLoginStore();
    const approved = store.create(KEY);
    store.approve(approved.approveCode, KEY);
    const waiting = store.create(KEY);
    expect(store.claim(approved.secret, OTHER)).toBe('expired');
    expect(store.lookup(waiting.approveCode, OTHER)).toBeNull();
    expect(store.approve(waiting.approveCode, OTHER)).toBe(false);
    expect(store.pending(waiting.secret, OTHER)).toBeNull();
  });

  it('returns the live pending request for reuse across reloads', () => {
    const store = new DeviceLoginStore();
    const request = store.create(KEY);
    expect(store.pending(request.secret, KEY)).toEqual(request);
    store.approve(request.approveCode, KEY);
    expect(store.pending(request.secret, KEY)).toBeNull();
  });

  it('drops the oldest request at the limit', () => {
    const store = new DeviceLoginStore(Date.now, DEVICE_LOGIN_TTL_MS, 3);
    const first = store.create(KEY);
    const rest = [store.create(KEY), store.create(KEY), store.create(KEY)];
    expect(store.size).toBe(3);
    expect(store.lookup(first.approveCode, KEY)).toBeNull();
    for (const request of rest) expect(store.lookup(request.approveCode, KEY)).not.toBeNull();
  });
});

describe('one-time link tokens', () => {
  it('redeems a fresh token once', () => {
    const now = 1_800_000_000_000;
    const verifier = new LinkTokenVerifier(() => now);
    const { token, expiresAt } = mintLinkToken(KEY, 5, now);
    expect(token).toMatch(/^v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(now + 5 * 60_000);
    expect(verifier.redeem(token, KEY)).toBe(true);
    expect(verifier.redeem(token, KEY)).toBe(false);
  });

  it('rejects tokens made with another key', () => {
    const verifier = new LinkTokenVerifier();
    expect(verifier.redeem(mintLinkToken(OTHER).token, KEY)).toBe(false);
  });

  it('rejects tampered tokens', () => {
    const verifier = new LinkTokenVerifier();
    const { token } = mintLinkToken(KEY, 1);
    const [version, expiry, nonce, mac] = token.split('.');
    const later = `${version}.${Number(expiry) + 600}.${nonce}.${mac}`;
    const flipped = `${version}.${expiry}.${nonce}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    expect(verifier.redeem(later, KEY)).toBe(false);
    expect(verifier.redeem(flipped, KEY)).toBe(false);
    expect(verifier.redeem('garbage', KEY)).toBe(false);
    expect(verifier.redeem(undefined, KEY)).toBe(false);
    expect(verifier.redeem(token, KEY)).toBe(true);
  });

  it('rejects expired tokens', () => {
    const time = clock(Date.now());
    const verifier = new LinkTokenVerifier(time.now);
    const { token } = mintLinkToken(KEY, 1, time.now());
    time.advance(60_000);
    expect(verifier.redeem(token, KEY)).toBe(false);
  });

  it('rejects tokens that live longer than the maximum', () => {
    const time = clock(Date.now());
    const verifier = new LinkTokenVerifier(time.now);
    const { token } = mintLinkToken(KEY, 15, time.now() + 10 * 60_000);
    expect(verifier.redeem(token, KEY)).toBe(false);
  });

  it('accepts only lifetimes from 1 to 15 minutes', () => {
    expect(() => mintLinkToken(KEY, 0)).toThrow();
    expect(() => mintLinkToken(KEY, 16)).toThrow();
    expect(() => mintLinkToken(KEY, 2.5)).toThrow();
    expect(() => mintLinkToken(KEY, 15)).not.toThrow();
  });
});

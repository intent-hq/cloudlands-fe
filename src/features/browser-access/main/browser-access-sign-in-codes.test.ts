// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  SIGN_IN_CODE_ALPHABET,
  SIGN_IN_CODE_MAX_ACTIVE,
  SIGN_IN_CODE_TTL_MS,
  createMemorySignInStore,
  createSignInCodes,
  formatSignInCode,
  generateSignInCode,
  normalizeSignInCode,
  parseSignInState,
  signInLink,
} from './browser-access-sign-in-codes';

const KEY = 'access-key-0123456789abcdefghijklmnopqrstuvwxyz';

function setup(start = Date.UTC(2026, 10, 4)) {
  let now = start;
  let key = KEY;
  const store = createMemorySignInStore();
  const codes = createSignInCodes({ store, getAccessKey: () => key, now: () => now });
  return {
    codes,
    store,
    advance: (ms: number) => (now += ms),
    setKey: (next: string) => (key = next),
  };
}

describe('sign-in code format', () => {
  it('uses an alphabet without look-alike characters', () => {
    expect(SIGN_IN_CODE_ALPHABET).toHaveLength(31);
    for (const lookAlike of ['0', 'O', '1', 'I', 'L']) {
      expect(SIGN_IN_CODE_ALPHABET).not.toContain(lookAlike);
    }
    expect(new Set(SIGN_IN_CODE_ALPHABET).size).toBe(SIGN_IN_CODE_ALPHABET.length);
  });

  it('generates 6-character codes over the whole alphabet', () => {
    const seen = new Set<string>();
    const codes = new Set<string>();
    for (let index = 0; index < 2000; index++) {
      const code = generateSignInCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      codes.add(code);
      for (const char of code) seen.add(char);
    }
    expect(seen.size).toBe(SIGN_IN_CODE_ALPHABET.length);
    expect(codes.size).toBeGreaterThan(1990);
  });

  it('displays as ABC-DEF and accepts any case, spaces and hyphens', () => {
    expect(formatSignInCode('ABCDEF')).toBe('ABC-DEF');
    expect(normalizeSignInCode('abc-def')).toBe('ABCDEF');
    expect(normalizeSignInCode(' a b c d e f ')).toBe('ABCDEF');
    expect(normalizeSignInCode('AB-CD-EF')).toBe('ABCDEF');
  });

  it('rejects anything that is not a code', () => {
    for (const input of ['ABCDE', 'ABCDEFG', 'ABC-DE0', 'ABCDEI', 'ABC_DEF', '', undefined, 42]) {
      expect(normalizeSignInCode(input)).toBeNull();
    }
    expect(normalizeSignInCode('A'.repeat(40))).toBeNull();
  });

  it('builds a link to the login page only when an origin is known', () => {
    expect(signInLink('https://box.ts.net', '/__browser-access/login', 'ABC-DEF')).toBe(
      'https://box.ts.net/__browser-access/login?code=ABCDEF',
    );
    expect(signInLink(null, '/__browser-access/login', 'ABC-DEF')).toBeNull();
  });
});

describe('createSignInCodes', () => {
  it('signs in once per code', async () => {
    const { codes } = setup();
    const { code } = await codes.create();
    expect(await codes.consume(code)).toBe('ok');
    expect(await codes.consume(code)).toBe('used-or-expired');
  });

  it('expires codes after 10 minutes', async () => {
    const { codes, advance } = setup();
    const created = await codes.create();
    advance(SIGN_IN_CODE_TTL_MS - 1);
    const other = await codes.create();
    advance(1);
    expect(await codes.consume(created.code)).toBe('used-or-expired');
    expect(await codes.consume(other.code)).toBe('ok');
  });

  it('reports an unknown code as invalid', async () => {
    const { codes } = setup();
    const { code } = await codes.create();
    const unknown = code === 'AAA-AAA' ? 'BBB-BBB' : 'AAA-AAA';
    expect(await codes.consume(unknown)).toBe('invalid');
    expect(await codes.consume('not a code')).toBe('invalid');
    expect(await codes.consume(code)).toBe('ok');
  });

  it('lets exactly one of many simultaneous consumers win', async () => {
    const { codes } = setup();
    const { code } = await codes.create();
    const results = await Promise.all(Array.from({ length: 8 }, () => codes.consume(code)));
    expect(results.filter((result) => result === 'ok')).toHaveLength(1);
  });

  it('invalidates every code when the access key changes', async () => {
    const { codes, setKey } = setup();
    const { code } = await codes.create();
    setKey('a-new-access-key-0123456789abcdefghijklmnopqrstu');
    expect(await codes.consume(code)).toBe('invalid');
  });

  it('forgets every code on clear', async () => {
    const { codes } = setup();
    const { code } = await codes.create();
    await codes.clear();
    expect(await codes.consume(code)).toBe('invalid');
  });

  it('keeps at most a few live codes, dropping the oldest', async () => {
    const { codes, advance } = setup();
    const created = [];
    for (let index = 0; index <= SIGN_IN_CODE_MAX_ACTIVE; index++) {
      created.push(await codes.create());
      advance(1000);
    }
    expect(await codes.consume(created[0].code)).toBe('invalid');
    for (const later of created.slice(1)) expect(await codes.consume(later.code)).toBe('ok');
  });

  it('stores only keyed hashes, never the code', async () => {
    const { codes, store } = setup();
    const { code } = await codes.create();
    const stored = JSON.stringify(await store.read());
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(code.replace('-', ''));
  });

  it('remembers the page origin', async () => {
    const { codes } = setup();
    expect(await codes.pageOrigin()).toBeNull();
    await codes.setPageOrigin('https://box.ts.net');
    expect(await codes.pageOrigin()).toBe('https://box.ts.net');
  });
});

describe('parseSignInState', () => {
  it('drops malformed entries and non-origin addresses', () => {
    expect(
      parseSignInState({
        codes: [{ hash: 'h', expiresAt: 1 }, { hash: 2 }, null, { hash: 'x', expiresAt: 'soon' }],
        pageOrigin: 'https://box.ts.net/path',
      }),
    ).toEqual({ codes: [{ hash: 'h', expiresAt: 1 }], pageOrigin: null });
    expect(parseSignInState({ pageOrigin: 'javascript:alert(1)' }).pageOrigin).toBeNull();
    expect(parseSignInState({ pageOrigin: 'https://box.ts.net' }).pageOrigin).toBe(
      'https://box.ts.net',
    );
    expect(parseSignInState('junk')).toEqual({ codes: [], pageOrigin: null });
  });
});

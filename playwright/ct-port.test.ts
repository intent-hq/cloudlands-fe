import { describe, expect, it } from 'vitest';
import { ctLockKey, ctPort } from '../scripts/verification-lock.mjs';
import { resolveCtPortConfig } from './ct-port';

describe('resolveCtPortConfig', () => {
  it("returns Playwright's defaults when CT_PORT is unset", () => {
    const expected = { port: 3100, cacheDir: 'playwright/.cache' };
    expect(resolveCtPortConfig({ env: {} })).toEqual(expected);
    expect(resolveCtPortConfig({ env: { CT_PORT: undefined } })).toEqual(expected);
  });

  it('derives the port and the cache dir from CT_PORT when it is set', () => {
    expect(resolveCtPortConfig({ env: { CT_PORT: '3101' } })).toEqual({
      port: 3101,
      cacheDir: 'playwright/.cache-3101',
    });
    expect(resolveCtPortConfig({ env: { CT_PORT: '3100' } })).toEqual({
      port: 3100,
      cacheDir: 'playwright/.cache-3100',
    });
  });

  it.each(['', ' ', '\t', ' \n '])('treats blank CT_PORT %j as unset', (raw) => {
    expect(resolveCtPortConfig({ env: { CT_PORT: raw } })).toEqual({
      port: 3100,
      cacheDir: 'playwright/.cache',
    });
  });

  it('trims surrounding whitespace and normalizes the numeric port', () => {
    expect(resolveCtPortConfig({ env: { CT_PORT: ' 3102 ' } })).toEqual({
      port: 3102,
      cacheDir: 'playwright/.cache-3102',
    });
    expect(resolveCtPortConfig({ env: { CT_PORT: '03101' } })).toEqual({
      port: 3101,
      cacheDir: 'playwright/.cache-3101',
    });
  });

  it.each([{}, { CT_PORT: ' ' }, { CT_PORT: '3101' }, { CT_PORT: ' 03102 ' }])(
    'agrees with the verification-lock port and lock key for env %j',
    (env) => {
      const { port } = resolveCtPortConfig({ env });
      expect(ctPort(env)).toBe(port);
      expect(ctLockKey(env)).toBe(`ct-${port}`);
    },
  );
});

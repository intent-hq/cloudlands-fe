import { describe, expect, it } from 'vitest';
import { resolveCtCacheDir } from './ct-cache-dir';

describe('resolveCtCacheDir', () => {
  it("returns Playwright's default when CT_PORT is unset", () => {
    expect(resolveCtCacheDir({ env: {} })).toBe('playwright/.cache');
    expect(resolveCtCacheDir({ env: { CT_PORT: undefined } })).toBe('playwright/.cache');
  });

  it('keys the dir by CT_PORT when it is set', () => {
    expect(resolveCtCacheDir({ env: { CT_PORT: '3101' } })).toBe('playwright/.cache-3101');
    expect(resolveCtCacheDir({ env: { CT_PORT: '3100' } })).toBe('playwright/.cache-3100');
  });

  it.each(['', ' ', '\t'])('falls back to the default for blank CT_PORT %j', (raw) => {
    expect(resolveCtCacheDir({ env: { CT_PORT: raw } })).toBe('playwright/.cache');
  });

  it('trims surrounding whitespace from CT_PORT', () => {
    expect(resolveCtCacheDir({ env: { CT_PORT: ' 3102 ' } })).toBe('playwright/.cache-3102');
  });
});

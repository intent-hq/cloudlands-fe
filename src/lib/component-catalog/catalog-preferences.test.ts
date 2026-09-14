import { describe, expect, it, vi } from 'vitest';
import {
  defaultCatalogPreferences,
  parseCatalogUrlSettings,
  readCatalogPreferences,
  writeCatalogPreferences,
} from './catalog-preferences';

describe('catalog preferences', () => {
  it('parses repeatable state, theme, width, and motion URL settings', () => {
    expect(
      parseCatalogUrlSettings(
        new URLSearchParams('state=loading&theme=dark&width=420&motion=reduced'),
      ),
    ).toEqual({ state: 'loading', theme: 'dark', width: 420, reducedMotion: true });
    expect(
      parseCatalogUrlSettings(
        new URLSearchParams('state=%20&theme=invalid&width=12&reducedMotion=false'),
      ),
    ).toEqual({ state: undefined, theme: undefined, width: undefined, reducedMotion: false });
  });

  it('accepts only the exact component fit mode', () => {
    expect(parseCatalogUrlSettings(new URLSearchParams('fit=component')).fit).toBe('component');
    expect(parseCatalogUrlSettings(new URLSearchParams('fit=Component')).fit).toBeUndefined();
    expect(parseCatalogUrlSettings(new URLSearchParams('fit=component%20')).fit).toBeUndefined();
    expect(parseCatalogUrlSettings(new URLSearchParams('fit=viewport')).fit).toBeUndefined();
  });

  it('validates partial and corrupt stored preferences', () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({ theme: 'dark', colorTheme: 'invalid', reducedMotion: true }),
      ),
    } as unknown as Storage;
    expect(readCatalogPreferences(storage)).toEqual({
      theme: 'dark',
      colorTheme: defaultCatalogPreferences.colorTheme,
      reducedMotion: true,
    });

    vi.mocked(storage.getItem).mockReturnValue('{');
    expect(readCatalogPreferences(storage)).toEqual(defaultCatalogPreferences);
  });

  it('writes one stable preference payload and tolerates unavailable storage', () => {
    const setItem = vi.fn();
    const storage = { setItem } as unknown as Storage;
    const value = {
      theme: 'light',
      colorTheme: 'dracula',
      reducedMotion: true,
    } as const;
    writeCatalogPreferences(storage, value);
    expect(setItem).toHaveBeenCalledWith('component-catalog-preferences', JSON.stringify(value));

    expect(() =>
      writeCatalogPreferences(
        {
          setItem: () => {
            throw new Error('unavailable');
          },
        } as unknown as Storage,
        value,
      ),
    ).not.toThrow();
  });
});

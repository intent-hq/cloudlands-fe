import { describe, expect, it } from 'vitest';
import {
  CUSTOM_VIEW_THEME_TOKENS,
  isCustomViewThemeInit,
  isCustomViewThemeReady,
  parseCustomViewThemeUpdate,
} from './index.js';

function update(cssVariables: Record<string, unknown> = { '--background': '210 20% 10%' }) {
  return {
    type: 'intent:theme:update',
    version: 1,
    theme: { version: 1, mode: 'dark', reducedMotion: false, cssVariables },
  };
}

describe('custom view theme protocol', () => {
  it('accepts only the versioned ready and init envelopes', () => {
    expect(isCustomViewThemeReady({ type: 'intent:theme:ready', version: 1 })).toBe(true);
    expect(isCustomViewThemeInit({ type: 'intent:theme:init', version: 1 })).toBe(true);
    for (const value of [null, [], {}, { type: 'intent:theme:init', version: 2 }]) {
      expect(isCustomViewThemeReady(value)).toBe(false);
      expect(isCustomViewThemeInit(value)).toBe(false);
    }
    expect(isCustomViewThemeReady({ type: 'intent:theme:init', version: 1 })).toBe(false);
    expect(isCustomViewThemeInit({ type: 'intent:theme:ready', version: 1 })).toBe(false);
    expect(isCustomViewThemeReady({ type: 'intent:theme:ready', version: 1, command: 'run' })).toBe(
      false,
    );
  });

  it('preserves canonical raw values across the public token families', () => {
    const cssVariables = {
      '--background': '210 20% 10%',
      '--font-ui': 'Example, sans-serif',
      '--text-body-size': '1rem',
      '--space-3': '0.75rem',
      '--radius-small': '8px',
      '--elevation-overlay': '0 2px 4px rgb(0 0 0 / 0.5)',
      '--surface-shadow-3': 'inset 0 1px 0 rgb(255 255 255 / 0.1)',
      '--spring-fast-ease': 'linear(\n  0,\n  0.5,\n  1\n)',
      '--motion-reduced': '0',
    };
    expect(parseCustomViewThemeUpdate(update(cssVariables))).toEqual({
      version: 1,
      mode: 'dark',
      reducedMotion: false,
      cssVariables,
    });
    expect(Object.isFrozen(CUSTOM_VIEW_THEME_TOKENS)).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...update(), type: 'intent:run' },
    { ...update(), version: 2 },
    { ...update(), command: 'run' },
    { ...update(), theme: null },
    { ...update(), theme: { ...update().theme, version: 2 } },
    { ...update(), theme: { ...update().theme, mode: 'system' } },
    { ...update(), theme: { ...update().theme, reducedMotion: 'false' } },
    { ...update(), theme: { ...update().theme, privateData: 'ignored?' } },
    { ...update(), theme: { ...update().theme, cssVariables: [] } },
    update({ '--theme-dark-background': '210 20% 10%' }),
    update({ color: 'red' }),
    update(JSON.parse('{"__proto__":"polluted"}')),
    update({ '--background': 42 }),
    update({ '--background': '' }),
    update({ '--background': ' \n\t' }),
    update({ '--background': 'x'.repeat(4097) }),
  ])('rejects malformed or nonpublic payload %#', (value) => {
    expect(parseCustomViewThemeUpdate(value)).toBeNull();
  });

  it('accepts a partial or empty snapshot and bounds each string', () => {
    expect(parseCustomViewThemeUpdate(update({}))).not.toBeNull();
    expect(parseCustomViewThemeUpdate(update({ '--font-ui': 'x'.repeat(4096) }))).not.toBeNull();
  });

  it('detaches and freezes both snapshot levels', () => {
    const message = update();
    const theme = parseCustomViewThemeUpdate(message)!;
    message.theme.mode = 'light';
    message.theme.cssVariables['--background'] = '0 0% 100%';
    expect(Reflect.set(theme, 'mode', 'light')).toBe(false);
    expect(Reflect.set(theme.cssVariables, '--background', '0 0% 100%')).toBe(false);
    expect(theme.mode).toBe('dark');
    expect(theme.cssVariables['--background']).toBe('210 20% 10%');
  });
});

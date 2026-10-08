import { CUSTOM_VIEW_THEME_TOKENS, type CustomViewTokenName } from './tokens.js';

export { CUSTOM_VIEW_THEME_TOKENS } from './tokens.js';
export type { CustomViewTokenName } from './tokens.js';

export interface CustomViewThemeSnapshot {
  readonly version: 1;
  readonly mode: 'light' | 'dark';
  readonly reducedMotion: boolean;
  /** Colors retain their canonical format, usually unwrapped HSL channels. */
  readonly cssVariables: Readonly<Partial<Record<CustomViewTokenName, string>>>;
}

export interface CustomViewThemeReady {
  type: 'intent:theme:ready';
  version: 1;
}

export interface CustomViewThemeInit {
  type: 'intent:theme:init';
  version: 1;
}

export interface CustomViewThemeUpdate {
  type: 'intent:theme:update';
  version: 1;
  theme: CustomViewThemeSnapshot;
}

const tokenNames: ReadonlySet<string> = new Set(CUSTOM_VIEW_THEME_TOKENS);
const MAX_TOKEN_VALUE_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isCustomViewThemeReady(value: unknown): value is CustomViewThemeReady {
  return (
    isRecord(value) &&
    hasKeys(value, ['type', 'version']) &&
    value.type === 'intent:theme:ready' &&
    value.version === 1
  );
}

export function isCustomViewThemeInit(value: unknown): value is CustomViewThemeInit {
  return (
    isRecord(value) &&
    hasKeys(value, ['type', 'version']) &&
    value.type === 'intent:theme:init' &&
    value.version === 1
  );
}

/** Validate the complete v1 message, then detach and freeze its public snapshot. */
export function parseCustomViewThemeUpdate(value: unknown): CustomViewThemeSnapshot | null {
  if (
    !isRecord(value) ||
    !hasKeys(value, ['type', 'version', 'theme']) ||
    value.type !== 'intent:theme:update' ||
    value.version !== 1
  ) {
    return null;
  }
  const theme = value.theme;
  if (
    !isRecord(theme) ||
    !hasKeys(theme, ['version', 'mode', 'reducedMotion', 'cssVariables']) ||
    theme.version !== 1 ||
    (theme.mode !== 'light' && theme.mode !== 'dark') ||
    typeof theme.reducedMotion !== 'boolean' ||
    !isRecord(theme.cssVariables)
  ) {
    return null;
  }
  const keys = Object.keys(theme.cssVariables);
  if (keys.length > CUSTOM_VIEW_THEME_TOKENS.length) return null;
  const cssVariables: Partial<Record<CustomViewTokenName, string>> = {};
  for (const key of keys) {
    const token = theme.cssVariables[key];
    if (
      !tokenNames.has(key) ||
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_VALUE_LENGTH ||
      token.trim().length === 0
    ) {
      return null;
    }
    cssVariables[key as CustomViewTokenName] = token;
  }
  return Object.freeze({
    version: 1,
    mode: theme.mode,
    reducedMotion: theme.reducedMotion,
    cssVariables: Object.freeze(cssVariables),
  });
}

import type { Resolvable, SettingEntry, SettingsCustomControls, SettingsSchema } from './types';

export function defineSettings<const T extends SettingsSchema>(schema: T): T {
  return schema;
}

export function defineSettingsCustomControls<const T extends SettingsCustomControls>(
  controls: T,
): T {
  return controls;
}

export function resolveSetting<T>(value: Resolvable<T> | undefined, fallback: T): T {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? (value as () => T)() : value;
}

/** Lower-cased whitespace-separated terms of a settings search query. */
function settingsSearchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every term of `query` occurs in `text`; an empty query matches everything. */
export function matchesSettingsSearchText(text: string, query: string): boolean {
  const terms = settingsSearchTerms(query);
  if (terms.length === 0) return true;
  const haystack = text.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function matchesSettingsSearch(entry: SettingEntry, query: string): boolean {
  return matchesSettingsSearchText(
    [entry.label, entry.description, entry.featureCode, entry.id].filter(Boolean).join(' '),
    query,
  );
}

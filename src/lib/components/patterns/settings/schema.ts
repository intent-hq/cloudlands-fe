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

export function matchesSettingsSearch(entry: SettingEntry, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [entry.label, entry.description, entry.featureCode, entry.id]
    .filter(Boolean)
    .some((value) => value!.toLocaleLowerCase().includes(normalized));
}

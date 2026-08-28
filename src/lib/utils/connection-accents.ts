import {
  CONNECTION_ACCENTS,
  DEFAULT_CONNECTION_ACCENT,
  SELECTABLE_CONNECTION_ACCENTS,
  type ConnectionAccent,
  type ConnectionAccentName,
} from '$shared/types/connections';

/** Tailwind-safe identity marker classes for the persisted machine accent palette. */
export const CONNECTION_ACCENT_CLASSES: Record<ConnectionAccentName, string> = {
  blue: 'bg-blue-600 dark:bg-blue-400',
  indigo: 'bg-indigo-600 dark:bg-indigo-400',
  violet: 'bg-violet-600 dark:bg-violet-400',
  rose: 'bg-rose-600 dark:bg-rose-400',
  orange: 'bg-orange-600 dark:bg-orange-400',
  emerald: 'bg-emerald-600 dark:bg-emerald-400',
  teal: 'bg-teal-600 dark:bg-teal-400',
};

/** Statically named palette tokens for inline color mixing that passes token auditing. */
export const CONNECTION_ACCENT_COLORS: Record<ConnectionAccentName, string> = {
  blue: 'var(--color-blue-500)',
  indigo: 'var(--color-indigo-500)',
  violet: 'var(--color-violet-500)',
  rose: 'var(--color-rose-500)',
  orange: 'var(--color-orange-500)',
  emerald: 'var(--color-emerald-500)',
  teal: 'var(--color-teal-500)',
};

/** Preserve an explicit blank while applying the legacy missing-value fallback. */
export function resolveConnectionAccent(accent: ConnectionAccent | undefined): ConnectionAccent {
  return accent === undefined ? DEFAULT_CONNECTION_ACCENT : accent;
}

/** New choices plus a current legacy accent so persisted values remain editable. */
export function connectionAccentOptions(current?: ConnectionAccent): readonly ConnectionAccent[] {
  return [
    null,
    ...CONNECTION_ACCENTS.filter(
      (accent) => SELECTABLE_CONNECTION_ACCENTS.includes(accent) || accent === current,
    ),
  ];
}

/** Low-opacity semantic background image layered over the application shell surface. */
export function connectionShellTint(
  accent: ConnectionAccent | undefined,
  isLocal: boolean,
): string | undefined {
  const resolved = resolveConnectionAccent(accent);
  if (isLocal || resolved === null) return undefined;
  return `linear-gradient(color-mix(in srgb, ${CONNECTION_ACCENT_COLORS[resolved]} 7%, transparent) 0 0)`;
}

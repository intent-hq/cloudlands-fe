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

/** Low-opacity semantic background layered with the application shell surface. */
export function connectionShellTint(
  accent: ConnectionAccent | undefined,
  isLocal: boolean,
): string | undefined {
  const resolved = resolveConnectionAccent(accent);
  if (isLocal || resolved === null) return undefined;
  return `color-mix(in srgb, var(--color-${resolved}-500) 7%, var(--panel-layout-surface))`;
}

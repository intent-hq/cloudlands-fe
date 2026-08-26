import type { ConnectionAccent } from '$shared/types/connections';

/** Tailwind-safe identity marker classes for the persisted machine accent palette. */
export const CONNECTION_ACCENT_CLASSES: Record<ConnectionAccent, string> = {
  blue: 'bg-blue-600 dark:bg-blue-400',
  indigo: 'bg-indigo-600 dark:bg-indigo-400',
  violet: 'bg-violet-600 dark:bg-violet-400',
  rose: 'bg-rose-600 dark:bg-rose-400',
  orange: 'bg-orange-600 dark:bg-orange-400',
  emerald: 'bg-emerald-600 dark:bg-emerald-400',
  teal: 'bg-teal-600 dark:bg-teal-400',
};

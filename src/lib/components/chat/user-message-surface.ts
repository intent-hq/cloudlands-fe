/** Shared visual contract for normal and pinned human prompts. */
export const USER_MESSAGE_SURFACE_CLASS =
  'relative overflow-hidden rounded-lg border border-border/50 bg-primary px-3 py-2 text-primary-foreground shadow-sm [&_a]:text-primary-foreground [&_a]:decoration-primary-foreground/70 [&_code]:bg-primary-foreground/15 [&_code]:text-primary-foreground';

export const USER_MESSAGE_TEXT_CLASS =
  // i18n-ignore (Tailwind class contract, not user-facing copy)
  'type-body font-medium! text-pretty text-primary-foreground selection:bg-primary-foreground selection:text-primary';

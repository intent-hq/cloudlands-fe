import type { TransitionConfig } from 'svelte/transition';
import { safeDisclosureTransition } from './disclosure-motion';

export const SUBSCRIPTION_ICON_CLASS = 'text-muted-foreground! opacity-100';
export const SUBSCRIPTION_ACTION_ICON_CLASS = 'text-ghost opacity-60';
export const SUBSCRIPTION_CARD_CONTAINMENT_CLASS =
  'w-full min-w-0 max-w-full overflow-hidden font-family-child';
export const SUBSCRIPTION_CARD_SURFACE_CLASS =
  'rounded-lg border border-border bg-card/80 shadow-sm';
export const EVENT_WAKEUP_IN_THREAD_SPACING_CLASS = 'mt-8';
export const SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS = 'mt-5';
export const SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS = 'type-body font-normal text-muted-foreground!'; // i18n-ignore (Tailwind class constants)
/** Shared summary-row recipe: 20px lead, 8px gap, 12px inset, and 36px minimum height. */
export const SUBSCRIPTION_ROW_GEOMETRY_CLASS =
  'flex h-9! min-h-9 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden border-0! px-3! py-2!';
export const SUBSCRIPTION_LEADING_COLUMN_CLASS =
  'inline-flex h-(--agent-avatar-standard-surface-size) w-(--agent-avatar-standard-surface-size) shrink-0 items-center justify-center leading-none';
export const SUBSCRIPTION_LEADING_CONTENT_CLASS = 'inline-flex min-w-0 items-center gap-2';
/** Expanded wake content aligns with the label after the 12px inset, 20px lead, and 8px gap. */
export const SUBSCRIPTION_WAKE_BODY_PADDING_CLASS = 'py-2 pr-3 pl-10';
export const SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS =
  "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border before:content-['']";
export const SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS = `${SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS} first:before:hidden`;
export const SUBSCRIPTION_DISCLOSURE_ROW_CLASS = `${SUBSCRIPTION_ROW_GEOMETRY_CLASS} type-body justify-start! font-normal text-muted-foreground!`; // i18n-ignore (Tailwind class constants)
export const SUBSCRIPTION_CHEVRON_CLASS =
  'text-ghost opacity-60 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none';
export const SUBSCRIPTION_CHEVRON_SIZE_CLASS = 'h-[16px]! w-[16px]!';
export const SUBSCRIPTION_ICON_BUTTON_CLASS =
  'border-0! bg-transparent! hover:bg-transparent! focus-visible:bg-transparent!';

export function safeSubscriptionSlide(
  node: Element,
  _params?: undefined,
  options: { direction?: 'in' | 'out' | 'both' } = {},
) {
  return safeDisclosureTransition(node, { duration: 150 }, options);
}

/** Keyed row motion: zero height to natural height, then back to zero on removal. */
export function safeSubscriptionRowTransition(
  node: Element,
  _params?: undefined,
  options: { direction?: 'in' | 'out' | 'both' } = {},
): TransitionConfig {
  return safeDisclosureTransition(node, { duration: 160, y: -2 }, options);
}

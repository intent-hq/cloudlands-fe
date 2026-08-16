import { safeSlide } from '$lib/utils/animations';

export const SUBSCRIPTION_ICON_CLASS = 'text-ghost opacity-60';
export const SUBSCRIPTION_CARD_CONTAINMENT_CLASS =
  'w-full min-w-0 max-w-full overflow-hidden font-family-child';
export const SUBSCRIPTION_CARD_SURFACE_CLASS =
  'rounded-lg border border-border/60 bg-card/80 shadow-sm';
export const SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS = 'mt-5';
export const SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS = 'type-body font-normal';
export const SUBSCRIPTION_ROW_GEOMETRY_CLASS = 'h-9! min-h-9 border-0! px-3! py-2!';
export const SUBSCRIPTION_LEADING_COLUMN_CLASS =
  'inline-flex size-5 shrink-0 items-center justify-center leading-none';
export const SUBSCRIPTION_LEADING_CONTENT_CLASS =
  'grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2';
export const SUBSCRIPTION_DISCLOSURE_ROW_CLASS =
  'type-body flex h-9! w-full min-w-0 max-w-full items-center gap-2 overflow-hidden px-3! py-2! font-normal text-subtle';
export const SUBSCRIPTION_COMPACT_DISCLOSURE_ROW_CLASS =
  'flex min-h-9 w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden px-3 py-2 text-sm text-subtle';
export const SUBSCRIPTION_CHEVRON_CLASS =
  'text-ghost opacity-60 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none';
export const SUBSCRIPTION_CHEVRON_SIZE_CLASS = 'h-[1.125rem]! w-[1.125rem]!';
export const SUBSCRIPTION_ICON_BUTTON_CLASS =
  'border-0! bg-transparent! hover:bg-transparent! focus-visible:bg-transparent!';

export function safeSubscriptionSlide(node: Element) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return safeSlide(node, { axis: 'y', duration: reduced ? 0 : 150 });
}

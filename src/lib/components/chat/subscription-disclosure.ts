import { safeSlide } from '$lib/utils/animations';

export const SUBSCRIPTION_ICON_CLASS = 'text-ghost opacity-60';
export const SUBSCRIPTION_CARD_CONTAINMENT_CLASS =
  'w-full min-w-0 max-w-full overflow-hidden font-family-child';
export const SUBSCRIPTION_CARD_SURFACE_CLASS =
  'rounded-lg border border-border/60 bg-card/80 px-1.5 py-1 shadow-sm';
export const SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS = 'type-body font-normal';
export const SUBSCRIPTION_DISCLOSURE_ROW_CLASS =
  'flex min-h-9 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden px-3 py-2 text-sm text-subtle';
export const SUBSCRIPTION_COMPACT_DISCLOSURE_ROW_CLASS =
  'flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden px-1.5 py-1 text-sm text-subtle';
export const SUBSCRIPTION_CHEVRON_CLASS =
  'text-ghost opacity-60 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none';
export const SUBSCRIPTION_CHEVRON_SIZE_CLASS = 'h-3.5! w-3.5!';
export const SUBSCRIPTION_ICON_BUTTON_CLASS =
  'border-0! bg-transparent! hover:bg-transparent! focus-visible:bg-transparent!';

export function safeSubscriptionSlide(node: Element) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return safeSlide(node, { axis: 'y', duration: reduced ? 0 : 150 });
}

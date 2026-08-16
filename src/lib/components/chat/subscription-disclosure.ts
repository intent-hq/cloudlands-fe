import { safeSlide } from '$lib/utils/animations';
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export const SUBSCRIPTION_ICON_CLASS = 'text-ghost opacity-60';
export const SUBSCRIPTION_CARD_CONTAINMENT_CLASS =
  'w-full min-w-0 max-w-full overflow-hidden font-family-child';
export const SUBSCRIPTION_CARD_SURFACE_CLASS =
  'rounded-lg border border-border bg-card/80 shadow-sm';
export const SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS = 'mt-5';
export const SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS = 'type-body font-normal';
export const SUBSCRIPTION_ROW_GEOMETRY_CLASS = 'h-9! min-h-9 border-0! px-3! py-2!';
export const SUBSCRIPTION_LEADING_COLUMN_CLASS =
  'inline-flex size-5 shrink-0 items-center justify-center leading-none';
export const SUBSCRIPTION_LEADING_CONTENT_CLASS =
  'grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2';
export const SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS =
  "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border before:content-['']";
export const SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS = `${SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS} first:before:hidden`;
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

/** Keyed row motion: zero height to natural height, then back to zero on removal. */
export function safeSubscriptionRowTransition(node: Element): TransitionConfig {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return { duration: 0 };

  const style = getComputedStyle(node);
  const height = Number.parseFloat(style.height);
  if (!Number.isFinite(height)) return { duration: 0 };

  const value = (property: keyof CSSStyleDeclaration) => {
    const parsed = Number.parseFloat(String(style[property]));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const opacity = Number.parseFloat(style.opacity);

  return {
    duration: 160,
    easing: cubicOut,
    css: (t, u) =>
      `overflow:hidden;height:${t * height}px;` +
      `padding-top:${t * value('paddingTop')}px;padding-bottom:${t * value('paddingBottom')}px;` +
      `margin-top:${t * value('marginTop')}px;margin-bottom:${t * value('marginBottom')}px;` +
      `opacity:${t * (Number.isFinite(opacity) ? opacity : 1)};transform:translateY(${-2 * u}px);`,
  };
}

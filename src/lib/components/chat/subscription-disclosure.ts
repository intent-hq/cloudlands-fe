import type { ImmediateMotionConfig as TransitionConfig } from '$lib/motion';
import { safeDisclosureTransition } from './disclosure-motion';

export {
  SUBSCRIPTION_ICON_CLASS,
  SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
  SUBSCRIPTION_CARD_SURFACE_CLASS,
  EVENT_WAKEUP_IN_THREAD_SPACING_CLASS,
  SUBSCRIPTION_IN_THREAD_CARD_SPACING_CLASS,
  SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  SUBSCRIPTION_ROW_GEOMETRY_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
  SUBSCRIPTION_LEADING_CONTENT_CLASS,
  SUBSCRIPTION_WAKE_BODY_PADDING_CLASS,
  SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
  SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_CHEVRON_CLASS,
  SUBSCRIPTION_CHEVRON_SIZE_CLASS,
  SUBSCRIPTION_ICON_BUTTON_CLASS,
  SUBSCRIPTION_TRAILING_CONTROLS_CLASS,
} from './subscription-disclosure-classes';

export function safeSubscriptionSlide(
  node: Element,
  _params?: undefined,
  options: { direction?: 'in' | 'out' | 'both' } = {},
) {
  return safeDisclosureTransition(node, { tier: 'fast' }, options);
}

/** Keyed row motion: zero height to natural height, then back to zero on removal. */
export function safeSubscriptionRowTransition(
  node: Element,
  _params?: undefined,
  options: { direction?: 'in' | 'out' | 'both' } = {},
): TransitionConfig {
  return safeDisclosureTransition(node, { tier: 'moderate', y: -2 }, options);
}

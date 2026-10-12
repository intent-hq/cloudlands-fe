import { debugConfig } from '$lib/config/debug';
import { createDisclosureTransition } from '$lib/components/chat/disclosure-motion-core';
import { createOperationalDetailsTransition, createSafeSlide } from '$lib/utils/safe-slide-core';
import { prefersReducedMotion } from '@/lib/motion/environment';
import { spring } from '@/lib/motion/springs';
import { crispOut, slide, springIn } from '@/lib/motion/transitions';

export type { DisclosureMotionParams } from '$lib/components/chat/disclosure-motion-core';

/** Canonical disclosure with the React motion recipes and the real followed-bottom lease. */
export const safeDisclosureTransition = createDisclosureTransition({
  spring,
  springIn,
  crispOut,
  prefersReducedMotion,
  areAnimationsEnabled: () => debugConfig.get('enableComponentTransitions'),
});

export const safeSlide = createSafeSlide(slide);

export const safeOperationalDetailsTransition = createOperationalDetailsTransition({
  safeSlide,
  prefersReducedMotion,
});

/** Stable presence factory matching Svelte's bidirectional transition directive. */
export function chatDisclosureTransition(node: HTMLElement) {
  return safeDisclosureTransition(node, { tier: 'moderate' }, { direction: 'both' });
}

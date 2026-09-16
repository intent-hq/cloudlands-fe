import { flip } from 'svelte/animate';
import type { AnimationConfig } from 'svelte/animate';
import { prefersReducedMotion } from '$lib/utils/reduced-motion';
import { safeDisclosureTransition } from './disclosure-motion';

export function taskProgressFlip(
  node: Element,
  bounds: { from: DOMRect; to: DOMRect },
): AnimationConfig {
  if (prefersReducedMotion()) return { duration: 0 };
  return flip(node, bounds, { duration: 180 });
}

export function taskProgressRowTransition(
  node: Element,
  _params?: undefined,
  options: { direction?: 'in' | 'out' | 'both' } = {},
) {
  return safeDisclosureTransition(node, { duration: 160, y: -2 }, options);
}

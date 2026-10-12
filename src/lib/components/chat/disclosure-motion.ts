import { crispOut, spring, springIn } from '$lib/motion';
import { areAnimationsEnabled } from '$lib/utils/animations';
import { prefersReducedMotion } from '$lib/utils/reduced-motion';
import { createDisclosureTransition } from './disclosure-motion-core';

/** Temporary Svelte compatibility binding, retained until the source renderer retires. */
export const safeDisclosureTransition = createDisclosureTransition({
  crispOut,
  spring,
  springIn,
  areAnimationsEnabled,
  prefersReducedMotion,
});

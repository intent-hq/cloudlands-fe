/** Animation utilities and source-renderer compatibility bindings. */
import { debugConfig } from '$lib/config/debug';
import { slide } from '$lib/motion';
import { createSafeSlide } from './safe-slide-core';

/** Temporary Svelte compatibility binding, retained until the source renderer retires. */
export const safeSlide = createSafeSlide(slide);

/** Check if animations are enabled. */
export function areAnimationsEnabled(): boolean {
  return debugConfig.get('enableComponentTransitions');
}

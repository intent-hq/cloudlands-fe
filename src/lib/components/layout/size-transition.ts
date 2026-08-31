import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export interface SizeTransitionParams {
  axis?: 'x' | 'y';
  duration?: number;
}

export function resize(
  node: HTMLElement,
  { axis = 'x', duration = 180 }: SizeTransitionParams = {},
): TransitionConfig {
  // Zero-duration plays (e.g. the suppressed intro on a keyed surface
  // remount during workspace switch) must not force a layout: skip the
  // measurement entirely instead of computing a size nobody animates.
  if (duration <= 0) return { duration: 0 };

  const rect = node.getBoundingClientRect();
  const dimension = axis === 'x' ? 'width' : 'height';
  const size = axis === 'x' ? rect.width : rect.height;

  return {
    duration,
    easing: cubicOut,
    css: (t) =>
      `overflow: hidden; ${dimension}: ${t * size}px; min-${dimension}: 0; max-${dimension}: ${t * size}px;`,
  };
}

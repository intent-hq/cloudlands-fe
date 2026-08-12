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

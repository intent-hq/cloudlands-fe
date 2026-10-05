import {
  crispOut,
  springIn,
  type ImmediateMotionConfig as TransitionConfig,
  type SpringTierName,
} from '$lib/motion';

export interface SizeTransitionParams {
  axis?: 'x' | 'y';
  enabled?: boolean;
  tier?: SpringTierName;
  duration?: number;
  easing?: TransitionConfig['easing'];
  fade?: boolean;
  clip?: boolean;
}

export function resize(
  node: HTMLElement,
  {
    axis = 'x',
    enabled = true,
    tier = 'moderate',
    duration,
    easing,
    fade = false,
    clip = true,
  }: SizeTransitionParams = {},
  options: { direction?: 'in' | 'out' | 'both' } = {},
): TransitionConfig {
  // Zero-duration plays (e.g. the suppressed intro on a keyed surface
  // remount during workspace switch) must not force a layout: skip the
  // measurement entirely instead of computing a size nobody animates.
  if (!enabled || duration === 0) return { duration: 0 };

  const rect = node.getBoundingClientRect();
  const dimension = axis === 'x' ? 'width' : 'height';
  const size = axis === 'x' ? rect.width : rect.height;

  const transition =
    options.direction === 'out' ? crispOut(node, { tier }) : springIn(node, { tier });
  return {
    duration: duration ?? transition.duration,
    easing: easing ?? transition.easing,
    css: (t) =>
      `${clip ? 'overflow: hidden; ' : ''}${dimension}: ${t * size}px; min-${dimension}: 0; max-${dimension}: ${t * size}px;${fade ? ` opacity: ${t};` : ''}`,
  };
}

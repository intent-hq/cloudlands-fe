/**
 * Animation utilities and configurations
 */

import { debugConfig } from '$lib/config/debug';
import { slide, type ImmediateMotionConfig, type SpringTierName } from '$lib/motion';

interface LegacySlideParams {
  axis?: 'x' | 'y';
  duration?: number;
}

interface ScaleParams {
  delay?: number;
  duration?: number;
  start?: number;
}

/**
 * Slide transition that degrades to a no-op when the node has no layout box.
 *
 * Svelte's `slide` computes `parseFloat(getComputedStyle(node).height)`; when the
 * node is not laid out (e.g. inside a `display: none` keep-alive tab wrapper),
 * the computed dimension is `"auto"`, parseFloat yields NaN, and the Web
 * Animations API rejects the keyframe with "Invalid keyframe value for property
 * height: NaNpx". Skipping the animation is safe: a node without a layout box is
 * not visible, so there is nothing to animate.
 */
export function safeSlide(node: Element, params: LegacySlideParams = {}): ImmediateMotionConfig {
  const dimension = (params.axis ?? 'y') === 'y' ? 'height' : 'width';
  const value = parseFloat(getComputedStyle(node)[dimension]);
  if (!Number.isFinite(value)) {
    return { duration: 0 };
  }
  const duration = params.duration ?? 160;
  const tier: SpringTierName = duration <= 80 ? 'fast' : duration <= 160 ? 'moderate' : 'slow';
  return slide(node, { axis: params.axis, tier }, { direction: 'in' }) as ImmediateMotionConfig;
}

/**
 * Get animation duration from debug config
 */
function getAnimationDuration(): number {
  return debugConfig.get('animationDuration') || 300;
}

/**
 * Check if animations are enabled
 */
export function areAnimationsEnabled(): boolean {
  return debugConfig.get('enableComponentTransitions');
}

/**
 * Scale transition with debug config
 */
export function scaleConfig(start = 0.95, delay = 0): ScaleParams {
  if (!areAnimationsEnabled()) {
    return { duration: 0 };
  }

  return {
    delay,
    duration: getAnimationDuration(),
    start,
  };
}

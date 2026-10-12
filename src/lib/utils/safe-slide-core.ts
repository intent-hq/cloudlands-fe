import type { ImmediateMotionConfig, MotionTransitionConfig } from '../motion/transitions';
import type { SpringTierName } from '../motion/springs';

export interface LegacySlideParams {
  axis?: 'x' | 'y';
  duration?: number;
}

/** Share the hidden-layout guard and legacy duration-to-tier mapping across renderers. */
export function createSafeSlide(
  slide: (
    node: Element,
    params: { axis?: 'x' | 'y'; tier: SpringTierName },
    options: { direction: 'in' },
  ) => MotionTransitionConfig,
) {
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
  function safeSlide(node: Element, params: LegacySlideParams = {}): ImmediateMotionConfig {
    const dimension = (params.axis ?? 'y') === 'y' ? 'height' : 'width';
    const value = parseFloat(getComputedStyle(node)[dimension]);
    if (!Number.isFinite(value)) {
      return { duration: 0 };
    }
    const duration = params.duration ?? 160;
    const tier: SpringTierName = duration <= 80 ? 'fast' : duration <= 160 ? 'moderate' : 'slow';
    return slide(node, { axis: params.axis, tier }, { direction: 'in' }) as ImmediateMotionConfig;
  }

  return safeSlide;
}

/** Keep the operational-row timing policy in one place for both renderers. */
export function createOperationalDetailsTransition({
  safeSlide,
  prefersReducedMotion,
}: {
  safeSlide: ReturnType<typeof createSafeSlide>;
  prefersReducedMotion: () => boolean;
}) {
  function safeOperationalDetailsTransition(node: Element) {
    return safeSlide(node, { axis: 'y', duration: prefersReducedMotion() ? 0 : 150 });
  }
  return safeOperationalDetailsTransition;
}

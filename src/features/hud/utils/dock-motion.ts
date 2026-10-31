import { spring, springIn, crispOut, type ImmediateMotionConfig } from '$lib/motion';

export const DOCK_HOVER_SCALE_MS = spring.moderate.settleMs;
export const DOCK_PRESS_SCALE_MS = spring.fast.settleMs;
export const DOCK_ITEM_TARGET_PX = 20;
export const DOCK_ITEM_GAP_PX = 3;
export const DOCK_RAIL_PADDING_PX = 4;
export const DOCK_ITEM_SLOT_PX = DOCK_ITEM_TARGET_PX + DOCK_ITEM_GAP_PX;
export const DOCK_NOTCH_HEIGHT_PX = 28;
export const DOCK_SHELL_OPEN_MS = spring.slow.settleMs;
export const DOCK_SHELL_CLOSE_MS = spring.slow.exit.duration;
/** Large shell morphs (the side conversation box): the slow tier, so travel per frame stays small. */
export const DOCK_SHELL_REVEAL = {
  openMs: DOCK_SHELL_OPEN_MS,
  closeMs: DOCK_SHELL_CLOSE_MS,
  openEasing: spring.slow.easing,
  closeEasing: spring.slow.exit.easing,
};
const DOCK_ACTIVE_SCALE = 1.35;
const DOCK_NEIGHBOR_SCALE = 1.15;
const DOCK_SECOND_NEIGHBOR_SCALE = 1.05;

const proximityScales = [DOCK_ACTIVE_SCALE, DOCK_NEIGHBOR_SCALE, DOCK_SECOND_NEIGHBOR_SCALE, 1];

export function getDockProximityScale(index: number, center: number | null): number {
  if (center === null) return 1;
  const distance = Math.min(proximityScales.length - 1, Math.abs(index - center));
  const lower = Math.floor(distance);
  const progress = distance - lower;
  const eased = progress * progress * (3 - 2 * progress);
  return (
    proximityScales[lower] +
    (proximityScales[Math.min(lower + 1, 3)] - proximityScales[lower]) * eased
  );
}

interface DockItemMotionParams {
  phase: 'enter' | 'exit';
  reducedMotion: boolean;
}

export function dockItemMotion(
  node: Element,
  { phase, reducedMotion }: DockItemMotionParams,
): ImmediateMotionConfig {
  if (reducedMotion) return { duration: 0 };
  return phase === 'enter'
    ? springIn(node, { tier: 'moderate', x: 2, y: 0, scale: 0.96 })
    : crispOut(node, { tier: 'fast', x: 2, y: 0, scale: 0.96 });
}

/** One sample of the tokenized open-height settle: moderate entry to grow, its exit to shrink. */
export function dockHeightStep(
  from: number,
  to: number,
  elapsed: number,
): { value: number; done: boolean } {
  const shrinking = to < from;
  const duration = shrinking ? spring.moderate.exit.duration : spring.moderate.settleMs;
  const easing = shrinking ? spring.moderate.exit.easing : spring.moderate.easing;
  const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 1;
  return { value: from + (to - from) * easing(progress), done: progress >= 1 };
}

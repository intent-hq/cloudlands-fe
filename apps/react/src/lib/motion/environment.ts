// Reuse the framework-neutral scheduler and owning-document motion policy.
export {
  scheduleLayoutRead,
  scheduleLayoutWrite,
  type CancelLayoutTask,
} from '$lib/utils/layout-phases';
export { prefersReducedMotion, onReducedMotionChange } from '$lib/utils/reduced-motion';

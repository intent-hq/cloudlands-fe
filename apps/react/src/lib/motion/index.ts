export {
  animatedHeight,
  useAnimatedHeight,
  type AnimatedHeightOptions,
  type AnimatedHeightParameter,
} from '@/lib/motion/animated-height';
export {
  Spring,
  spring,
  springValue,
  tweenedValue,
  exitFallbackMs,
  type SpringTierName,
  type SpringTier,
  type SpringExit,
} from '@/lib/motion/springs';
export { prefersReducedMotion, onReducedMotionChange } from '@/lib/motion/environment';
export {
  fade,
  fly,
  slide,
  scale,
  blur,
  draw,
  springIn,
  crispOut,
  timedFade,
} from '@/lib/motion/transitions';
export type {
  TransitionConfig,
  MotionTransitionConfig,
  ImmediateMotionConfig,
  MotionParams,
  AxisMotionParams,
  DistanceMotionParams,
  TimedFadeParams,
  SpringInParams,
  CrispOutParams,
} from '@/lib/motion/transitions';
export {
  createTransition,
  usePresence,
  usePresenceTransition,
  type PresenceEntry,
  type TransitionFactory,
} from '@/lib/motion/presence';

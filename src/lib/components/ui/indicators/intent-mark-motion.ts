export const intentMarkVariants = ['bloom', 'pulse', 'twist'] as const;
export type IntentMarkVariant = (typeof intentMarkVariants)[number];

export const intentMarkMotionTiming = {
  settleMs: 160,
  bloomMs: 61_000 / 30,
  pulseMs: 61_000 / 30,
  twistMs: 110_000 / 30,
} as const;

export interface IntentMarkMotionOptions {
  variant: IntentMarkVariant;
  playing: boolean;
}

export interface IntentMarkMotionController {
  update(options: IntentMarkMotionOptions): void;
  destroy(): void;
}

const neutralFrame: Keyframe = {
  opacity: 1,
  strokeDasharray: '100 100',
  strokeDashoffset: 0,
  transform: 'translate(0px, 0px) rotate(0deg) scale(1)',
};

const legacyPathData = [
  'M76 8L94 61C99 76 92 83 78 77L27 48',
  'M180 8L162 61C157 76 164 83 178 77L229 48',
  'M16 104L68 96C83 94 89 102 79 114L45 157',
  'M240 104L188 96C173 94 167 102 177 114L211 157',
  'M128 126L128 184',
] as const;

const bloomPathData = [
  'M92.148293 3.803071L112.21 58.92178C117.575582 73.663539 101.604204 87.065138 88.018096 79.221207L37.220352 49.893204',
  'M221.41417 49.978045L170.616426 79.306048C157.030318 87.149979 141.05894 73.74838 146.424522 59.006621L166.486229 3.887912',
  'M24.769303 119.698155L82.534231 109.51261C97.983713 106.788469 108.40846 124.844303 98.324395 136.861921L60.621011 181.795086',
  'M195.378989 181.795086L157.675605 136.861921C147.59154 124.844303 158.016287 106.788469 173.465769 109.51261L231.230697 119.698155',
  'M128 135.5954L128 208.081',
] as const;

const bloomSourceIndexByPath = [2, 3, 1, 4, 0] as const;
const canonicalLoopPhase: Record<IntentMarkVariant, number> = {
  bloom: 35 / 61,
  pulse: 0.5,
  twist: 0.2,
};

function cssPath(path: string): string {
  return `path("${path}")`;
}

interface VariantGeometry {
  pathData: string;
  strokeWidth: number;
  transformOrigin: string;
}

function variantGeometry(variant: IntentMarkVariant, index: number): VariantGeometry {
  const bloom = variant === 'bloom';
  return {
    pathData: bloom ? bloomPathData[index] : legacyPathData[index],
    strokeWidth: bloom ? 18.45088 : 18,
    transformOrigin: bloom ? '128px 101px' : '128px 96px',
  };
}

function variantFrame(variant: IntentMarkVariant, index: number): Keyframe {
  const geometry = variantGeometry(variant, index);
  return {
    d: cssPath(geometry.pathData),
    strokeWidth: geometry.strokeWidth,
    transformOrigin: geometry.transformOrigin,
  };
}

function applyVariantGeometry(
  arm: SVGSVGElement,
  path: SVGPathElement,
  variant: IntentMarkVariant,
  index: number,
): void {
  const geometry = variantGeometry(variant, index);
  path.setAttribute('d', geometry.pathData);
  path.style.strokeWidth = String(geometry.strokeWidth);
  path.style.transformOrigin = geometry.transformOrigin;
  arm.style.transformOrigin = '0px 0px';
}

interface LottieScalarKeyframe {
  frame: number;
  value: number;
  incoming?: readonly [number, number];
  outgoing?: readonly [number, number];
}

const bloomFrameCount = 61;
const bloomLayerOutFrame = 56;
const bloomControllerRotation: readonly LottieScalarKeyframe[] = [
  { frame: 0, value: -40, incoming: [0.085, 1], outgoing: [0.01, 0.405] },
  { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 0.221] },
  { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.167, 0] },
  { frame: 65, value: 20 },
];
const bloomArmRotations: readonly (readonly LottieScalarKeyframe[])[] = [
  [
    { frame: 0, value: -1, incoming: [0, 1], outgoing: [0.01, 0.336] },
    { frame: 25, value: 0 },
  ],
  [
    { frame: 0, value: -40, incoming: [0.094, 1], outgoing: [0.006, 0.435] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 0.211] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.599, 0] },
    { frame: 65, value: 340 },
  ],
  [
    { frame: 0, value: -120, incoming: [0.094, 1], outgoing: [0.006, 0.144] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 1.034] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.549, 0] },
    { frame: 65, value: 260 },
  ],
  [
    { frame: 0, value: -200, incoming: [0.094, 1], outgoing: [0.006, 0.086] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 1.857] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.5, 0] },
    { frame: 65, value: 180 },
  ],
  [
    { frame: 0, value: -280, incoming: [0.085, 1], outgoing: [0.005, 0.205] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 2.172] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.45, 0] },
    { frame: 65, value: 100 },
  ],
];
const bloomBottomTrimStart: readonly LottieScalarKeyframe[] = [
  { frame: 0, value: 100, incoming: [0, 1], outgoing: [0.013, 0.332] },
  { frame: 25, value: 0, incoming: [0.833, 1], outgoing: [0.167, 0] },
  { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.17, 0] },
  { frame: 54, value: 100 },
];
const bloomArmTrimStart: readonly LottieScalarKeyframe[] = [
  { frame: 0, value: 50, incoming: [0.028, 0.901], outgoing: [0.015, 0.187] },
  { frame: 19, value: 1.208, incoming: [0.629, 1], outgoing: [0.298, 1.547] },
  { frame: 43, value: 0, incoming: [0, 1], outgoing: [0.001, 0.141] },
  { frame: 65, value: 50 },
];
const bloomArmTrimEnd: readonly LottieScalarKeyframe[] = [
  { frame: 0, value: 50, incoming: [0.028, 0.901], outgoing: [0.013, 0.118] },
  { frame: 19, value: 98.792, incoming: [0.629, 1], outgoing: [0.298, 1.547] },
  { frame: 43, value: 100, incoming: [0, 1], outgoing: [0.001, 0.141] },
  { frame: 65, value: 50 },
];
const legacyTrimOrigins = [
  [76, 8],
  [180, 8],
  [16, 104],
  [240, 104],
  [128, 126],
] as const;
const bloomTrimOrigins = [
  [107.22094, 77.541115],
  [151.413589, 77.625977],
  [100.004395, 117.659111],
  [155.99559, 117.659126],
  [128, 171.838196],
] as const;

function compositedTransform(
  variant: IntentMarkVariant,
  index: number,
  rotation = 0,
  scale = 1,
  visible = 1,
): string {
  const bloom = variant === 'bloom';
  const centerY = bloom ? 101 : 96;
  const [trimX, trimY] = (bloom ? bloomTrimOrigins : legacyTrimOrigins)[index];
  return `translate(128px, ${centerY}px) rotate(${rotation}deg) scale(${scale}) translate(-128px, ${-centerY}px) translate(${trimX}px, ${trimY}px) scale(${visible}) translate(${-trimX}px, ${-trimY}px)`;
}

function cubicCoordinate(progress: number, first: number, second: number): number {
  const inverse = 1 - progress;
  return (
    3 * inverse * inverse * progress * first +
    3 * inverse * progress * progress * second +
    progress ** 3
  );
}

function cubicBezierProgress(
  progress: number,
  outgoing: readonly [number, number],
  incoming: readonly [number, number],
): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (cubicCoordinate(midpoint, outgoing[0], incoming[0]) < progress) low = midpoint;
    else high = midpoint;
  }
  return cubicCoordinate((low + high) / 2, outgoing[1], incoming[1]);
}

function sampleLottieTrack(track: readonly LottieScalarKeyframe[], frame: number): number {
  const first = track[0];
  if (!first || frame <= first.frame) return first?.value ?? 0;
  for (let index = 1; index < track.length; index += 1) {
    const next = track[index];
    const previous = track[index - 1];
    if (frame > next.frame) continue;
    if (frame === next.frame) return next.value;
    const progress = (frame - previous.frame) / (next.frame - previous.frame);
    const eased = cubicBezierProgress(
      progress,
      previous.outgoing ?? [0, 0],
      previous.incoming ?? [1, 1],
    );
    return previous.value + (next.value - previous.value) * eased;
  }
  return track.at(-1)?.value ?? 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

const pulseTranslations = [
  [-11, -20],
  [11, -20],
  [-21, 8],
  [21, 8],
  [0, 0],
] as const;

function pulseFrames(index: number): Keyframe[] {
  const [x, y] = pulseTranslations[index];
  return [
    { transform: neutralFrame.transform, offset: 0 },
    {
      transform: `translate(${x}px, ${y}px) rotate(0deg) scale(1)`,
      offset: 0.5,
    },
    { transform: neutralFrame.transform, offset: 1 },
  ];
}

function bloomPose(index: number, frame: number): Keyframe {
  const sourceIndex = bloomSourceIndexByPath[index];
  const start = Math.max(
    0,
    Math.min(
      100,
      sampleLottieTrack(sourceIndex === 0 ? bloomBottomTrimStart : bloomArmTrimStart, frame),
    ),
  );
  const end = Math.max(
    0,
    Math.min(100, sourceIndex === 0 ? 100 : sampleLottieTrack(bloomArmTrimEnd, frame)),
  );
  const visible = rounded(Math.max(0, end - start));
  const visibility = visible / 100;
  const rotation = rounded(
    sampleLottieTrack(bloomControllerRotation, frame) +
      sampleLottieTrack(bloomArmRotations[sourceIndex], frame),
  );
  return {
    opacity: frame < bloomLayerOutFrame ? 1 : 0,
    transform: compositedTransform('bloom', index, rotation, 1, visibility),
  };
}

function bloomFrames(index: number): Keyframe[] {
  const sourceFrames = Array.from({ length: bloomFrameCount + 1 }, (_, frame) => frame);
  sourceFrames.splice(bloomLayerOutFrame, 0, bloomLayerOutFrame - 0.001);
  return sourceFrames.map((frame) => {
    const pose = bloomPose(index, frame);
    return {
      opacity: pose.opacity,
      transform: pose.transform,
      offset: frame / bloomFrameCount,
      easing: 'steps(1, end)',
    };
  });
}

function twistFrames(index: number): Keyframe[] {
  const direction = index % 2 === 0 ? -1 : 1;
  const start = 0.06 * index;
  const end = 0.76 + 0.04 * index;
  const transitionOffset = intentMarkMotionTiming.settleMs / intentMarkMotionTiming.twistMs;
  const loopNeutralFrame: Keyframe = {
    opacity: neutralFrame.opacity,
    transform: compositedTransform('twist', index),
  };
  const sourceEntryFrame: Keyframe = {
    opacity: 0.12,
    transform: compositedTransform('twist', index, direction * 12, 0.72, 0.16),
  };
  const sourceExitFrame: Keyframe = {
    opacity: 0.12,
    transform: compositedTransform('twist', index, -direction * 10, 0.68, 0.08),
  };
  return [
    { ...loopNeutralFrame, offset: 0 },
    ...(start > 0 ? [{ ...loopNeutralFrame, offset: start }] : []),
    { ...sourceEntryFrame, offset: start + transitionOffset },
    { ...loopNeutralFrame, offset: Math.min(0.42, start + 0.3) },
    { ...loopNeutralFrame, offset: Math.min(0.82, end) },
    { ...sourceExitFrame, offset: Math.min(1 - transitionOffset, end + 0.16) },
    { ...loopNeutralFrame, offset: 1 },
  ];
}

function loopFrames(variant: IntentMarkVariant, index: number): Keyframe[] {
  if (variant === 'pulse') return pulseFrames(index);
  if (variant === 'twist') return twistFrames(index);
  return bloomFrames(index);
}

function loopDuration(variant: IntentMarkVariant): number {
  return intentMarkMotionTiming[`${variant}Ms`];
}

function stripTiming(frame: Keyframe): Keyframe {
  const { offset: _offset, easing: _easing, composite: _composite, ...pose } = frame;
  return pose;
}

function numeric(value: string | number | null | undefined): number {
  return Number.parseFloat(String(value ?? 0));
}

function interpolateTransform(from: string, to: string, progress: number): string {
  const values = (transform: string) =>
    [...transform.matchAll(/-?[\d.]+/g)].map(([value]) => Number(value));
  const start = values(from);
  const end = values(to);
  if (start.length !== end.length) return progress < 0.5 ? from : to;
  const at = (index: number) => rounded(start[index] + (end[index] - start[index]) * progress);
  let index = 0;
  return to.replace(/-?[\d.]+/g, () => String(at(index++)));
}

function loopPoseAt(variant: IntentMarkVariant, index: number, phase: number): Keyframe {
  if (variant === 'bloom') return bloomPose(index, phase * bloomFrameCount);
  const frames = loopFrames(variant, index);
  const exact = frames.find(({ offset }) => Math.abs(Number(offset) - phase) < 0.000_001);
  if (exact) return stripTiming(exact);
  const afterIndex = frames.findIndex(({ offset }) => Number(offset) > phase);
  const after = frames[afterIndex];
  const before = frames[Math.max(0, afterIndex - 1)];
  if (!before || !after) return stripTiming(frames.at(-1) ?? neutralFrame);
  const progress = (phase - Number(before.offset)) / (Number(after.offset) - Number(before.offset));
  return {
    ...stripTiming(before),
    opacity: rounded(
      numeric(before.opacity) + (numeric(after.opacity) - numeric(before.opacity)) * progress,
    ),
    strokeDashoffset: rounded(
      numeric(before.strokeDashoffset) +
        (numeric(after.strokeDashoffset) - numeric(before.strokeDashoffset)) * progress,
    ),
    transform: interpolateTransform(String(before.transform), String(after.transform), progress),
  };
}

function renderedPose(path: SVGPathElement, motionTarget: Element): Keyframe {
  const pathStyle = getComputedStyle(path);
  const motionStyle = getComputedStyle(motionTarget);
  const renderedPath = pathStyle.getPropertyValue('d');
  return {
    d:
      renderedPath && renderedPath !== 'none'
        ? renderedPath
        : cssPath(path.getAttribute('d') ?? ''),
    opacity: motionStyle.opacity || 1,
    strokeDasharray: pathStyle.strokeDasharray || neutralFrame.strokeDasharray,
    strokeDashoffset: pathStyle.strokeDashoffset || neutralFrame.strokeDashoffset,
    strokeWidth: pathStyle.strokeWidth || 18,
    transform: motionStyle.transform === 'none' ? neutralFrame.transform : motionStyle.transform,
    transformOrigin: pathStyle.transformOrigin || '128px 96px',
  };
}

export function createIntentMarkMotion(
  root: SVGSVGElement,
  initial: IntentMarkMotionOptions,
): IntentMarkMotionController {
  const arms = Array.from(root.querySelectorAll<SVGSVGElement>('[data-mark-arm-box]'));
  const paths = Array.from(root.querySelectorAll<SVGPathElement>('[data-mark-arm]'));
  if (arms.length !== legacyPathData.length || paths.length !== legacyPathData.length)
    throw new Error('Intent mark arms are missing');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let options = initial;
  let inViewport = true;
  let visible = !document.hidden;
  let destroyed = false;
  let sequence = 0;
  let animations: Animation[] = [];
  let activeVariant: IntentMarkVariant | undefined;
  let transitionTimer: number | undefined;
  let transition: 'morph' | 'settle' | undefined;
  let needsHandoff = true;

  const cancelAnimations = () => {
    if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    transitionTimer = undefined;
    for (const animation of animations) animation.cancel();
    animations = [];
    arms.forEach((arm) => (arm.style.willChange = ''));
  };

  const setNeutral = () => {
    cancelAnimations();
    paths.forEach((path, index) => applyVariantGeometry(arms[index], path, 'pulse', index));
    activeVariant = undefined;
    transition = undefined;
    needsHandoff = true;
    delete root.dataset.handoffVariant;
    delete root.dataset.loopPhase;
    root.dataset.motionState = 'neutral';
  };

  const canPlay = () => options.playing && inViewport && visible && !media.matches && !destroyed;

  const hasRunningLoop = () =>
    activeVariant === options.variant &&
    animations.length === arms.length &&
    animations.every(
      (animation) =>
        animation.playState === 'running' &&
        (!('replaceState' in animation) || animation.replaceState !== 'removed'),
    );

  const startLoop = (variant: IntentMarkVariant, phase = canonicalLoopPhase[variant]) => {
    if (!canPlay()) return;
    cancelAnimations();
    paths.forEach((path, index) => applyVariantGeometry(arms[index], path, variant, index));
    transition = undefined;
    needsHandoff = false;
    const duration = loopDuration(variant);
    root.dataset.motionState = 'playing';
    animations = arms.map((arm, index) => {
      arm.style.willChange = 'transform, opacity';
      const animation = arm.animate(loopFrames(variant, index), {
        duration: loopDuration(variant),
        easing: 'linear',
        iterations: Infinity,
      });
      animation.currentTime = phase * duration;
      return animation;
    });
    activeVariant = variant;
    delete root.dataset.handoffVariant;
    root.dataset.loopPhase = String(phase);
  };

  const finishTransition = (run: number, complete: () => void) => {
    const guardedComplete = () => {
      if (run !== sequence || destroyed) return;
      complete();
    };
    if (animations[0]) animations[0].onfinish = guardedComplete;
    transitionTimer = window.setTimeout(guardedComplete, intentMarkMotionTiming.settleMs);
  };

  const morphTo = (variant: IntentMarkVariant) => {
    if (!canPlay()) return;
    const run = ++sequence;
    const from = paths.map((path, index) => renderedPose(path, transition ? path : arms[index]));
    const phase = canonicalLoopPhase[variant];
    const to = paths.map((_, index) => ({
      ...variantFrame(variant, index),
      ...neutralFrame,
      ...loopPoseAt(variant, index, phase),
      transformOrigin: '0px 0px',
    }));
    cancelAnimations();
    activeVariant = undefined;
    transition = 'morph';
    needsHandoff = false;
    root.dataset.motionState = 'morphing';
    root.dataset.handoffVariant = variant;
    root.dataset.loopPhase = String(phase);
    animations = paths.map((path, index) =>
      path.animate([from[index], to[index]], {
        duration: intentMarkMotionTiming.settleMs,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }),
    );
    finishTransition(run, () => {
      if (transition !== 'morph') return;
      if (canPlay() && options.variant === variant) startLoop(variant, phase);
      else setNeutral();
    });
  };

  const settle = () => {
    const run = ++sequence;
    if (media.matches || !inViewport || !visible || destroyed) {
      setNeutral();
      return;
    }
    const from = paths.map((path, index) => renderedPose(path, transition ? path : arms[index]));
    const to = paths.map((_, index) => ({
      ...variantFrame('pulse', index),
      ...neutralFrame,
    }));
    cancelAnimations();
    activeVariant = undefined;
    transition = 'settle';
    root.dataset.motionState = 'settling';
    animations = paths.map((path, index) =>
      path.animate([from[index], to[index]], {
        duration: intentMarkMotionTiming.settleMs,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }),
    );
    finishTransition(run, () => {
      if (transition === 'settle') setNeutral();
    });
  };

  const reconcile = (variantChanged = false) => {
    if (!canPlay()) {
      if (media.matches || !inViewport || !visible || destroyed) {
        setNeutral();
        return;
      }
      if (transition !== 'settle' && (animations.length > 0 || activeVariant || transition))
        settle();
      else setNeutral();
      return;
    }
    if (variantChanged) {
      morphTo(options.variant);
      return;
    }
    if (transition === 'settle') {
      morphTo(options.variant);
      return;
    }
    if (transition === 'morph') return;
    if (activeVariant && activeVariant !== options.variant) {
      morphTo(options.variant);
      return;
    }
    if (!hasRunningLoop()) {
      if (activeVariant || needsHandoff) morphTo(options.variant);
      else startLoop(options.variant);
    }
  };

  const handleVisibility = () => {
    visible = !document.hidden;
    reconcile();
  };
  const handleMotionPreference = () => reconcile();
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(([entry]) => {
          inViewport = entry?.isIntersecting ?? true;
          reconcile();
        });

  observer?.observe(root);
  document.addEventListener('visibilitychange', handleVisibility);
  media.addEventListener('change', handleMotionPreference);
  reconcile();

  return {
    update(next) {
      const variantChanged = next.variant !== options.variant;
      options = next;
      reconcile(variantChanged);
    },
    destroy() {
      destroyed = true;
      sequence += 1;
      cancelAnimations();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      media.removeEventListener('change', handleMotionPreference);
      root.dataset.motionState = 'destroyed';
    },
  };
}

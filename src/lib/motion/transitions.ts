import { cubicOut } from 'svelte/easing';
import {
  blur as svelteBlur,
  draw as svelteDraw,
  fade as svelteFade,
  fly as svelteFly,
  scale as svelteScale,
  slide as svelteSlide,
  type TransitionConfig,
} from 'svelte/transition';
import { prefersReducedMotion, spring, type SpringTierName } from './springs';

export interface SpringInParams {
  tier: SpringTierName;
  x?: number | string;
  y?: number | string;
  scale?: number;
  opacity?: number;
}

export type CrispOutParams = SpringInParams;

function cssTimeMs(value: string, fallback: number): number {
  const match = value.trim().match(/^(-?[\d.]+)(ms|s)$/);
  if (!match) return fallback;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount * (match[2] === 's' ? 1000 : 1) : fallback;
}

function customProperty(style: CSSStyleDeclaration, name: string): string {
  return typeof style.getPropertyValue === 'function' ? style.getPropertyValue(name) : '';
}

function linearEasing(value: string): ((t: number) => number) | undefined {
  const match = value.trim().match(/^linear\((.*)\)$/);
  if (!match) return undefined;
  const points = match[1].split(',').map((part) => {
    const fields = part.trim().split(/\s+/);
    const output = Number(fields[0]);
    const stop = fields[1]?.endsWith('%') ? Number.parseFloat(fields[1]) / 100 : undefined;
    return { output, stop };
  });
  if (points.length < 2 || points.some(({ output }) => !Number.isFinite(output))) return undefined;
  points[0].stop ??= 0;
  points[points.length - 1].stop ??= 1;
  for (let start = 0; start < points.length - 1; start += 1) {
    if (points[start + 1].stop !== undefined) continue;
    let end = start + 2;
    while (end < points.length && points[end].stop === undefined) end += 1;
    const from = points[start].stop ?? 0;
    const to = points[end]?.stop ?? 1;
    for (let index = start + 1; index < end; index += 1) {
      points[index].stop = from + ((to - from) * (index - start)) / (end - start);
    }
  }
  return (t) => {
    const end = points.findIndex(({ stop }) => (stop ?? 1) >= t);
    if (end <= 0) return points[0].output;
    const before = points[end - 1];
    const after = points[end];
    const distance = (after.stop ?? 1) - (before.stop ?? 0);
    const progress = distance === 0 ? 1 : (t - (before.stop ?? 0)) / distance;
    return before.output + (after.output - before.output) * progress;
  };
}

function tierConfig(node: Element, tier: SpringTierName, exit = false) {
  const style = getComputedStyle(node);
  const suffix = exit ? '-exit' : '';
  const fallback = exit ? spring[tier].exit.duration : spring[tier].settleMs;
  return {
    duration: cssTimeMs(customProperty(style, `--spring-${tier}${suffix}`), fallback),
    easing: exit
      ? spring[tier].exit.easing
      : (linearEasing(customProperty(style, `--spring-${tier}-ease`)) ?? cubicOut),
  };
}

type MotionDirection = 'in' | 'out';
type MotionDirectionHint = MotionDirection | 'both';
type DeferredTransitionConfig = (options?: { direction?: MotionDirection }) => TransitionConfig;
export type MotionTransitionConfig = TransitionConfig | DeferredTransitionConfig;
export type ImmediateMotionConfig = TransitionConfig;

export interface MotionParams {
  tier?: SpringTierName;
}

export interface AxisMotionParams extends MotionParams {
  axis?: 'x' | 'y';
}

export interface DistanceMotionParams extends AxisMotionParams {
  distance?: number | string;
}

function motionTransition(
  node: Element,
  tier: SpringTierName,
  hint: MotionDirectionHint,
  transition: (config: ReturnType<typeof tierConfig>) => TransitionConfig,
): MotionTransitionConfig {
  if (prefersReducedMotion()) {
    const instant = (): TransitionConfig => ({ duration: 0 });
    return hint === 'both' ? instant : instant();
  }
  if (hint !== 'both') return transition(tierConfig(node, tier, hint === 'out'));
  const entrance = tierConfig(node, tier);
  const exit = tierConfig(node, tier, true);
  return ({ direction = 'in' } = {}) => transition(direction === 'out' ? exit : entrance);
}

export function fade(
  node: Element,
  { tier = 'moderate' }: MotionParams = {},
  { direction = 'in' }: { direction?: MotionDirectionHint } = {},
): MotionTransitionConfig {
  return motionTransition(node, tier, direction, (config) => svelteFade(node, config));
}

export function fly(
  node: Element,
  { tier = 'moderate', distance = 8, axis = 'y' }: DistanceMotionParams = {},
  { direction = 'in' }: { direction?: MotionDirectionHint } = {},
): MotionTransitionConfig {
  return motionTransition(node, tier, direction, (config) =>
    svelteFly(node, { ...config, [axis]: distance }),
  );
}

export function slide(
  node: Element,
  { tier = 'moderate', axis = 'y' }: AxisMotionParams = {},
  { direction = 'in' }: { direction?: MotionDirectionHint } = {},
): MotionTransitionConfig {
  return motionTransition(node, tier, direction, (config) =>
    svelteSlide(node, { ...config, axis }),
  );
}

export function scale(
  node: Element,
  { tier = 'moderate', distance = 0.04 }: Omit<DistanceMotionParams, 'axis'> = {},
  { direction = 'in' }: { direction?: MotionDirectionHint } = {},
): MotionTransitionConfig {
  const amount = typeof distance === 'number' ? distance : Number.parseFloat(distance);
  const start = 1 - Math.max(0, Math.min(Number.isFinite(amount) ? amount : 0.04, 1));
  return motionTransition(node, tier, direction, (config) =>
    svelteScale(node, { ...config, start, opacity: start === 1 ? 1 : 0 }),
  );
}

export function blur(
  node: Element,
  { tier = 'moderate', distance = 3 }: Omit<DistanceMotionParams, 'axis'> = {},
  { direction = 'in' }: { direction?: MotionDirectionHint } = {},
): MotionTransitionConfig {
  return motionTransition(node, tier, direction, (config) =>
    svelteBlur(node, { ...config, amount: distance }),
  );
}

export function draw(
  node: SVGElement & { getTotalLength(): number },
  { tier = 'moderate' }: MotionParams = {},
  { direction = 'in' }: { direction?: MotionDirectionHint } = {},
): MotionTransitionConfig {
  return motionTransition(node, tier, direction, (config) => svelteDraw(node, config));
}

function offset(value: number | string, progress: number): string {
  return typeof value === 'number' ? `${value * progress}px` : `calc(${value} * ${progress})`;
}

export function springIn(node: Element, params: SpringInParams): TransitionConfig {
  if (prefersReducedMotion()) return { duration: 0 };
  const { tier, x = 0, y = 4, scale = 0.98, opacity = 0 } = params;
  const style = getComputedStyle(node);
  const targetOpacity = Number.parseFloat(style.opacity) || 1;
  const baseTransform = style.transform === 'none' ? '' : ` ${style.transform}`;
  return {
    ...tierConfig(node, tier),
    css: (t) =>
      `opacity:${opacity + (targetOpacity - opacity) * t};transform:translate3d(${offset(x, 1 - t)},${offset(y, 1 - t)},0) scale(${scale + (1 - scale) * t})${baseTransform}`,
  };
}

export function crispOut(
  node: Element,
  { tier, x = 0, y = 0, scale = 1, opacity = 0 }: CrispOutParams,
): TransitionConfig {
  if (prefersReducedMotion()) return { duration: 0 };
  const style = getComputedStyle(node);
  const targetOpacity = Number.parseFloat(style.opacity) || 1;
  const baseTransform = style.transform === 'none' ? '' : ` ${style.transform}`;
  const moves = x !== 0 || y !== 0 || scale !== 1 || opacity !== 0;
  return {
    ...tierConfig(node, tier, true),
    css: moves
      ? (t) =>
          `opacity:${opacity + (targetOpacity - opacity) * t};transform:translate3d(${offset(x, 1 - t)},${offset(y, 1 - t)},0) scale(${scale + (1 - scale) * t})${baseTransform}`
      : (t) => `opacity:${targetOpacity * t}`,
  };
}

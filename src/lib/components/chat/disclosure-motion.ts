import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { areAnimationsEnabled } from '$lib/utils/animations';
import { beforeFollowBottomMutation, type FollowBottomMutation } from '$lib/utils/smartScroll';

interface DisclosureMotionParams {
  duration?: number;
  y?: number;
}

function numericStyle(style: CSSStyleDeclaration, property: keyof CSSStyleDeclaration): number {
  const value = Number.parseFloat(String(style[property]));
  return Number.isFinite(value) ? value : 0;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** Shared intrinsic-height disclosure motion with an optional followed-bottom lease. */
export function safeDisclosureTransition(
  node: Element,
  params: DisclosureMotionParams = {},
  options: { direction?: 'in' | 'out' | 'both' } = {},
): TransitionConfig {
  const element = node as HTMLElement;
  let bottomMutation: FollowBottomMutation | null = beforeFollowBottomMutation(element);
  const settleBottomMutation = () => {
    bottomMutation?.settle();
    bottomMutation = null;
  };
  const acquireBottomMutation = () => {
    bottomMutation ??= beforeFollowBottomMutation(element);
  };

  if (!areAnimationsEnabled() || prefersReducedMotion()) {
    settleBottomMutation();
    return { duration: 0 };
  }

  const style = getComputedStyle(element);
  const height = numericStyle(style, 'height') || element.getBoundingClientRect().height;
  if (!Number.isFinite(height) || height <= 0) {
    settleBottomMutation();
    return { duration: 0 };
  }

  const opacity = numericStyle(style, 'opacity') || 1;
  const duration = params.duration ?? 180;
  const y = params.y ?? -4;
  let previousT: number | null = null;
  let phase: 'intro' | 'idle' | 'outro' =
    options.direction === 'out' ? 'outro' : options.direction === 'in' ? 'intro' : 'idle';

  return {
    duration,
    easing: cubicOut,
    css: (t, u) =>
      `overflow:hidden;height:${t * height}px;` +
      `padding-top:${t * numericStyle(style, 'paddingTop')}px;` +
      `padding-bottom:${t * numericStyle(style, 'paddingBottom')}px;` +
      `margin-top:${t * numericStyle(style, 'marginTop')}px;` +
      `margin-bottom:${t * numericStyle(style, 'marginBottom')}px;` +
      `opacity:${t * opacity};transform:translateY(${y * u}px);`,
    tick: (t) => {
      if (options.direction === 'both' && previousT !== null) {
        if (t < previousT) {
          acquireBottomMutation();
          phase = 'outro';
        } else if (t > previousT) {
          acquireBottomMutation();
          phase = 'intro';
        }
      }
      bottomMutation?.request();
      if ((t === 1 && phase === 'intro') || (t === 0 && phase === 'outro')) {
        settleBottomMutation();
        phase = 'idle';
      }
      previousT = t;
    },
  };
}

import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { areAnimationsEnabled, prefersReducedMotion } from '$lib/utils/animations';
import { beforeFollowBottomMutation, type FollowBottomMutation } from '$lib/utils/smartScroll';

interface DisclosureMotionParams {
  duration?: number;
  y?: number;
}

function numericStyle(style: CSSStyleDeclaration, property: keyof CSSStyleDeclaration): number {
  const value = Number.parseFloat(String(style[property]));
  return Number.isFinite(value) ? value : 0;
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
  const paddingTop = numericStyle(style, 'paddingTop');
  const paddingBottom = numericStyle(style, 'paddingBottom');
  const marginTop = numericStyle(style, 'marginTop');
  const marginBottom = numericStyle(style, 'marginBottom');
  let previousT: number | null = null;
  let phase: 'intro' | 'idle' | 'outro' =
    options.direction === 'out' ? 'outro' : options.direction === 'in' ? 'intro' : 'idle';

  // Frame styles are applied from `tick` (not `css`) on purpose: a `css`
  // transition becomes a Web Animation whose height updates at the start of
  // each frame, BEFORE the rAF callbacks that re-pin a followed-bottom
  // viewport run — so any same-frame reader observes the grown content with
  // the previous frame's scrollTop (a per-frame bottom-distance drift equal
  // to the height delta). Driving the styles from `tick` keeps the height
  // mutation and the followed-bottom correction in one synchronous task.
  const applyFrameStyles = (t: number, u: number) => {
    element.style.overflow = 'hidden';
    element.style.height = `${t * height}px`;
    element.style.paddingTop = `${t * paddingTop}px`;
    element.style.paddingBottom = `${t * paddingBottom}px`;
    element.style.marginTop = `${t * marginTop}px`;
    element.style.marginBottom = `${t * marginBottom}px`;
    element.style.opacity = `${t * opacity}`;
    element.style.transform = `translateY(${y * u}px)`;
  };
  const clearFrameStyles = () => {
    element.style.overflow = '';
    element.style.height = '';
    element.style.paddingTop = '';
    element.style.paddingBottom = '';
    element.style.marginTop = '';
    element.style.marginBottom = '';
    element.style.opacity = '';
    element.style.transform = '';
  };

  return {
    duration,
    easing: cubicOut,
    tick: (t, u) => {
      if (options.direction === 'both') {
        if (previousT === null) {
          // Svelte discards the cached config after `introend`, so a `both`
          // outro re-enters here with `phase === 'idle'`. When throttled rAF
          // delivers the whole outro as a single tick (t === 0), the reversal
          // detection below never runs and the lease would leak — classify a
          // first tick below 1 as an outro so that tick settles the lease. A
          // true intro start (also t === 0) settles harmlessly: its next tick
          // re-acquires through the reversal path before any growth applies.
          if (t < 1) phase = 'outro';
        } else if (t < previousT) {
          acquireBottomMutation();
          phase = 'outro';
        } else if (t > previousT) {
          acquireBottomMutation();
          phase = 'intro';
        }
      }
      previousT = t;
      if (t === 1 && phase !== 'outro') {
        // Fully shown (intro end, or an interrupted outro reset to its start):
        // restore the natural styles and release the followed-bottom lease.
        // The phase guard keeps a pure `out:` play (phase starts as 'outro')
        // from settling on a first tick whose rAF timestamp lands exactly on
        // the start time (easing(0) = 0 ⇒ t = 1) — re-acquisition only exists
        // on the `direction === 'both'` reversal path.
        clearFrameStyles();
        settleBottomMutation();
        phase = 'idle';
        return;
      }
      applyFrameStyles(t, u);
      bottomMutation?.request();
      if (t === 0 && phase === 'outro') {
        // Outro end: keep the collapsed styles (the element is removed next)
        // but release the lease so the follower can settle.
        settleBottomMutation();
        phase = 'idle';
      }
    },
  };
}

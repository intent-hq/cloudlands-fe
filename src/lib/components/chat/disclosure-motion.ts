import {
  crispOut,
  prefersReducedMotion,
  spring,
  springIn,
  type ImmediateMotionConfig as TransitionConfig,
  type SpringTierName,
} from '$lib/motion';
import { areAnimationsEnabled } from '$lib/utils/animations';
import { beforeFollowBottomMutation, type FollowBottomMutation } from '$lib/utils/smartScroll';

interface DisclosureMotionParams {
  tier?: SpringTierName;
  axis?: 'x' | 'y';
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
  const axis = params.axis ?? 'y';
  const rect = element.getBoundingClientRect();
  const size =
    axis === 'y'
      ? numericStyle(style, 'height') || rect.height
      : numericStyle(style, 'width') || rect.width;
  if (!Number.isFinite(size) || size <= 0) {
    settleBottomMutation();
    return { duration: 0 };
  }

  const opacity = numericStyle(style, 'opacity') || 1;
  const tierName = params.tier ?? 'moderate';
  const tier = spring[tierName];
  const isOutro = options.direction === 'out';
  const tierTransition =
    typeof style.getPropertyValue === 'function'
      ? isOutro
        ? crispOut(element, { tier: tierName })
        : springIn(element, { tier: tierName })
      : { duration: isOutro ? tier.exit.duration : tier.settleMs, easing: tier.exit.easing };
  const duration = tierTransition.duration ?? (isOutro ? tier.exit.duration : tier.settleMs);
  const y = params.y ?? -4;
  const paddingTop = numericStyle(style, 'paddingTop');
  const paddingBottom = numericStyle(style, 'paddingBottom');
  const marginTop = numericStyle(style, 'marginTop');
  const marginBottom = numericStyle(style, 'marginBottom');
  const paddingLeft = numericStyle(style, 'paddingLeft');
  const paddingRight = numericStyle(style, 'paddingRight');
  const marginLeft = numericStyle(style, 'marginLeft');
  const marginRight = numericStyle(style, 'marginRight');
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
    if (axis === 'y') {
      element.style.height = `${t * size}px`;
      element.style.paddingTop = `${t * paddingTop}px`;
      element.style.paddingBottom = `${t * paddingBottom}px`;
      element.style.marginTop = `${t * marginTop}px`;
      element.style.marginBottom = `${t * marginBottom}px`;
    } else {
      element.style.width = `${t * size}px`;
      element.style.paddingLeft = `${t * paddingLeft}px`;
      element.style.paddingRight = `${t * paddingRight}px`;
      element.style.marginLeft = `${t * marginLeft}px`;
      element.style.marginRight = `${t * marginRight}px`;
    }
    element.style.opacity = `${t * opacity}`;
    element.style.transform = axis === 'y' ? `translateY(${y * u}px)` : `translateX(${y * u}px)`;
  };
  const clearFrameStyles = () => {
    element.style.overflow = '';
    element.style.height = '';
    element.style.width = '';
    element.style.paddingTop = '';
    element.style.paddingBottom = '';
    element.style.marginTop = '';
    element.style.marginBottom = '';
    element.style.paddingLeft = '';
    element.style.paddingRight = '';
    element.style.marginLeft = '';
    element.style.marginRight = '';
    element.style.opacity = '';
    element.style.transform = '';
  };

  return {
    duration,
    easing: tierTransition.easing,
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

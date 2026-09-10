import {
  intentMarkKeyframes,
  intentMarkMotionTiming,
  type IntentMarkVariant,
} from './intent-mark-vector';
export {
  intentMarkMotionTiming,
  intentMarkVariants,
  type IntentMarkVariant,
} from './intent-mark-vector';

export interface IntentMarkMotionOptions {
  variant: IntentMarkVariant;
  playing: boolean;
}

export interface IntentMarkMotionController {
  update(options: IntentMarkMotionOptions): void;
  destroy(): void;
}

export function createIntentMarkMotion(
  root: SVGSVGElement,
  initial: IntentMarkMotionOptions,
): IntentMarkMotionController {
  const neutral = root.querySelector<SVGGElement>('[data-mark-layer]');
  if (!neutral) throw new Error('Intent mark layer is missing');
  const template = neutral.cloneNode(true) as SVGGElement;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let options = initial;
  let inViewport = true;
  let visible = !document.hidden;
  let destroyed = false;
  let sequence = 0;
  let current = neutral;
  let outgoing: SVGGElement | undefined;
  let loops: Animation[] = [];
  let fades: Animation[] = [];
  let activeVariant: IntentMarkVariant | undefined;
  let transitionTimer: number | undefined;
  let transitioning = false;

  const cancelAnimations = () => {
    if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    transitionTimer = undefined;
    for (const animation of loops) animation.cancel();
    loops = [];
    for (const animation of fades) animation.cancel();
    fades = [];
    current.style.willChange = '';
    if (outgoing) outgoing.style.willChange = '';
  };

  const setNeutral = () => {
    sequence += 1;
    cancelAnimations();
    current = template.cloneNode(true) as SVGGElement;
    root.replaceChildren(current);
    outgoing = undefined;
    activeVariant = undefined;
    transitioning = false;
    root.dataset.motionState = 'neutral';
  };

  const canPlay = () => options.playing && inViewport && visible && !media.matches && !destroyed;

  const startLoop = (variant: IntentMarkVariant) => {
    loops = Array.from(current.querySelectorAll<SVGPathElement>('[data-mark-arm]')).map(
      (path, index) =>
        path.animate(intentMarkKeyframes(variant, index), {
          duration: intentMarkMotionTiming[`${variant}Ms`],
          easing: 'linear',
          iterations: Infinity,
        }),
    );
    root.dataset.motionState = 'playing';
  };

  const transitionTo = (variant?: IntentMarkVariant) => {
    const run = ++sequence;
    // Freeze the rendered vector pose before cancel. Rapid updates keep at most
    // two layers and cannot revive the callbacks from an earlier handoff.
    for (const path of current.querySelectorAll<SVGPathElement>('[data-mark-arm]')) {
      const rendered = getComputedStyle(path);
      for (const property of [
        'd',
        'fill',
        'stroke',
        'transform',
        'opacity',
        'stroke-dasharray',
        'stroke-dashoffset',
        'stroke-width',
      ])
        path.style.setProperty(property, rendered.getPropertyValue(property));
    }
    const style = getComputedStyle(current);
    const transform = style.transform;
    const opacity = style.opacity || '1';
    cancelAnimations();
    outgoing?.remove();
    outgoing = current;
    outgoing.style.transform = transform;
    outgoing.style.opacity = opacity;
    current = template.cloneNode(true) as SVGGElement;
    if (variant) {
      current.dataset.markLayer = variant;
      current.querySelectorAll<SVGPathElement>('[data-mark-arm]').forEach((path, index) => {
        const {
          offset: _offset,
          easing: _easing,
          ...pose
        } = intentMarkKeyframes(variant, index)[0];
        Object.assign(path.style, pose);
      });
    }
    root.append(current);
    activeVariant = variant;
    transitioning = true;
    root.dataset.motionState = variant ? 'morphing' : 'settling';
    const timing = {
      duration: intentMarkMotionTiming.settleMs,
      easing: 'linear',
      fill: 'forwards' as const,
    };
    fades = [
      outgoing.animate([{ opacity }, { opacity: 0 }], timing),
      current.animate([{ opacity: 0 }, { opacity: 1 }], timing),
    ];
    const complete = () => {
      if (run !== sequence || destroyed || !transitioning) return;
      cancelAnimations();
      outgoing?.remove();
      outgoing = undefined;
      transitioning = false;
      if (variant && canPlay()) startLoop(variant);
      else setNeutral();
    };
    fades[0].onfinish = complete;
    transitionTimer = window.setTimeout(complete, intentMarkMotionTiming.settleMs);
  };

  const reconcile = () => {
    if (destroyed) return;
    if (!canPlay()) {
      if (media.matches || !inViewport || !visible) {
        setNeutral();
        return;
      }
      if (activeVariant) transitionTo();
      return;
    }
    if (activeVariant === options.variant) {
      if (transitioning) return;
      if (
        loops.length === 5 &&
        loops.every(
          (loop) =>
            ['running', 'paused'].includes(loop.playState) && loop.replaceState !== 'removed',
        )
      )
        return;
    }
    transitionTo(options.variant);
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
      options = next;
      reconcile();
    },
    destroy() {
      destroyed = true;
      sequence += 1;
      cancelAnimations();
      outgoing?.remove();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      media.removeEventListener('change', handleMotionPreference);
      root.dataset.motionState = 'destroyed';
    },
  };
}

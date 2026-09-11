import { currentFrameTime, subscribeFrameClock } from '$lib/utils/frame-clock';
import { intentMarkPoses } from './intent-mark-poses';
import { intentMarkMotionTiming, type IntentMarkVariant } from './intent-mark-vector';
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
  // Avoid building invisible loops before the observer's first notification.
  let inViewport = typeof IntersectionObserver === 'undefined';
  let visible = !document.hidden;
  let windowFocused = !document.documentElement.hasAttribute('data-window-blurred');
  let destroyed = false;
  let sequence = 0;
  let current = neutral;
  let outgoing: SVGGElement | undefined;
  let fades: Animation[] = [];
  let stopLoop: (() => void) | undefined;
  let activeVariant: IntentMarkVariant | undefined;
  let transitionTimer: number | undefined;
  let transitioning = false;
  let isNeutral = true;

  const cancelAnimations = () => {
    if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    transitionTimer = undefined;
    stopLoop?.();
    stopLoop = undefined;
    for (const animation of fades) animation.cancel();
    fades = [];
    current.style.willChange = '';
    if (outgoing) outgoing.style.willChange = '';
  };

  const setNeutral = () => {
    if (isNeutral) return;
    sequence += 1;
    cancelAnimations();
    current = template.cloneNode(true) as SVGGElement;
    root.replaceChildren(current);
    outgoing = undefined;
    activeVariant = undefined;
    transitioning = false;
    isNeutral = true;
    root.dataset.motionState = 'neutral';
  };

  const mustRest = () => media.matches || !inViewport || !visible || !windowFocused || destroyed;
  const canPlay = () => options.playing && !mustRest();

  const startLoop = (variant: IntentMarkVariant) => {
    const paths = Array.from(current.querySelectorAll<SVGPathElement>('[data-mark-arm]'));
    const poses = paths.map((_, index) => intentMarkPoses(variant, index));
    const origin = currentFrameTime();
    let previousFrame = 0;
    const writePose = (time: number) => {
      const frame = Math.round(((time - origin) * 30) / 1000) % poses[0].length;
      if (frame === previousFrame) return;
      paths.forEach((path, index) => {
        const pose = poses[index][frame];
        const previous = poses[index][previousFrame];
        // Compare cached strings, not CSSOM serialization; identical holds and
        // unchanging properties cause no DOM mutations or style reads.
        for (const property in pose) {
          if (pose[property] !== previous[property])
            Object.assign(path.style, { [property]: pose[property] });
        }
      });
      previousFrame = frame;
    };
    // The incoming layer already holds frame zero throughout its crossfade.
    stopLoop = subscribeFrameClock(writePose);
    root.dataset.motionState = 'playing';
  };

  const transitionTo = (variant?: IntentMarkVariant) => {
    const run = ++sequence;
    isNeutral = false;
    // Freeze the rendered vector pose before cancel. Rapid updates keep at most
    // two layers and cannot revive the callbacks from an earlier handoff.
    const properties = [
      'd',
      'fill',
      'stroke',
      'transform',
      'opacity',
      'stroke-dasharray',
      'stroke-dashoffset',
      'stroke-width',
    ];
    // Computed styles are live: snapshot every value before the first write,
    // otherwise each write invalidates the next read and forces another flush.
    const poses = Array.from(current.querySelectorAll<SVGPathElement>('[data-mark-arm]')).map(
      (path) => {
        const rendered = getComputedStyle(path);
        return { path, values: properties.map((property) => rendered.getPropertyValue(property)) };
      },
    );
    const style = getComputedStyle(current);
    const transform = style.transform;
    const opacity = style.opacity || '1';
    for (const { path, values } of poses)
      properties.forEach((property, index) => path.style.setProperty(property, values[index]));
    cancelAnimations();
    outgoing?.remove();
    outgoing = current;
    outgoing.style.transform = transform;
    outgoing.style.opacity = opacity;
    current = template.cloneNode(true) as SVGGElement;
    if (variant) {
      current.dataset.markLayer = variant;
      current.querySelectorAll<SVGPathElement>('[data-mark-arm]').forEach((path, index) => {
        Object.assign(path.style, intentMarkPoses(variant, index)[0]);
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
      if (mustRest()) {
        setNeutral();
        return;
      }
      if (activeVariant) transitionTo();
      return;
    }
    if (activeVariant === options.variant) {
      if (transitioning) return;
      if (stopLoop) return;
    }
    transitionTo(options.variant);
  };

  const handleVisibility = () => {
    visible = !document.hidden;
    reconcile();
  };
  const handleWindowFocusChange = () => {
    const focused = !document.documentElement.hasAttribute('data-window-blurred');
    if (focused === windowFocused) return;
    windowFocused = focused;
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
  const windowFocusObserver = new MutationObserver(handleWindowFocusChange);

  observer?.observe(root);
  windowFocusObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-window-blurred'],
  });
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
      windowFocusObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      media.removeEventListener('change', handleMotionPreference);
      root.dataset.motionState = 'destroyed';
    },
  };
}

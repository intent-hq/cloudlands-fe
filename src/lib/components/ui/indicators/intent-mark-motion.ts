import bloomUrl from '../../../../../static/intent-mark/bloom.png?url';
import pulseUrl from '../../../../../static/intent-mark/pulse.png?url';
import twistUrl from '../../../../../static/intent-mark/twist.png?url';

export const intentMarkVariants = ['bloom', 'pulse', 'twist'] as const;
export type IntentMarkVariant = (typeof intentMarkVariants)[number];

export const intentMarkMotionTiming = {
  settleMs: 160,
  bloomMs: 51 * 40,
  pulseMs: 51 * 40,
  twistMs: 92 * 40,
} as const;

export interface IntentMarkMotionOptions {
  variant: IntentMarkVariant;
  playing: boolean;
}

export interface IntentMarkMotionController {
  update(options: IntentMarkMotionOptions): void;
  destroy(): void;
}

const atlases = {
  bloom: { url: bloomUrl, frames: 51, rows: 7 },
  pulse: { url: pulseUrl, frames: 51, rows: 7 },
  twist: { url: twistUrl, frames: 92, rows: 12 },
} as const;

// The source GIFs are 256px square, 40ms per frame. Only the sheet moves;
// steps hold each complete source frame, including the last frame before wrap.
function loopFrames(variant: IntentMarkVariant): Keyframe[] {
  const count = atlases[variant].frames;
  return Array.from({ length: count + 1 }, (_, index) => {
    const frame = index % count;
    return {
      transform: `translate(${-(frame % 8) * 256}px, ${-Math.floor(frame / 8) * 256}px)`,
      offset: index / count,
      easing: 'steps(1, end)',
    };
  });
}

export function createIntentMarkMotion(
  root: SVGSVGElement,
  initial: IntentMarkMotionOptions,
): IntentMarkMotionController {
  const neutral = root.querySelector<HTMLElement>('[data-mark-sheet]');
  if (!neutral?.parentElement) throw new Error('Intent mark sheet is missing');
  const viewport = neutral.parentElement;
  const template = neutral.cloneNode(false) as HTMLElement;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let options = initial;
  let inViewport = true;
  let visible = !document.hidden;
  let destroyed = false;
  let sequence = 0;
  let current: HTMLElement = neutral;
  let outgoing: HTMLElement | undefined;
  let loop: Animation | undefined;
  let fades: Animation[] = [];
  let activeVariant: IntentMarkVariant | undefined;
  let transitionTimer: number | undefined;
  let transitioning = false;

  const cancelAnimations = () => {
    if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    transitionTimer = undefined;
    loop?.cancel();
    loop = undefined;
    for (const animation of fades) animation.cancel();
    fades = [];
    current.style.willChange = '';
    if (outgoing) outgoing.style.willChange = '';
  };

  const setNeutral = () => {
    sequence += 1;
    cancelAnimations();
    current = template.cloneNode(false) as HTMLElement;
    viewport.replaceChildren(current);
    outgoing = undefined;
    activeVariant = undefined;
    transitioning = false;
    root.dataset.motionState = 'neutral';
  };

  const canPlay = () => options.playing && inViewport && visible && !media.matches && !destroyed;

  const startLoop = (variant: IntentMarkVariant) => {
    current.style.willChange = 'transform';
    loop = current.animate(loopFrames(variant), {
      duration: intentMarkMotionTiming[`${variant}Ms`],
      easing: 'linear',
      iterations: Infinity,
    });
    root.dataset.motionState = 'playing';
  };

  const transitionTo = (variant?: IntentMarkVariant) => {
    const run = ++sequence;
    // Freeze the outgoing source frame before cancelling its transform animation.
    // Rapid updates discard the stale outgoing sheet, so at most two are retained.
    const style = getComputedStyle(current);
    const transform = style.transform;
    const opacity = style.opacity || '1';
    cancelAnimations();
    outgoing?.remove();
    outgoing = current;
    outgoing.style.transform = transform;
    outgoing.style.opacity = opacity;
    current = template.cloneNode(false) as HTMLElement;
    if (variant) {
      const atlas = atlases[variant];
      current.dataset.markSheet = variant;
      current.style.maskImage = `url("${atlas.url}")`;
      current.style.width = '2048px';
      current.style.height = `${atlas.rows * 256}px`;
    }
    viewport.append(current);
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
      if (loop && ['running', 'paused'].includes(loop.playState) && loop.replaceState !== 'removed')
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

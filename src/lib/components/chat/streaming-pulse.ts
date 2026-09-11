import type { Action } from 'svelte/action';
import { currentFrameTime, subscribeFrameClock } from '$lib/utils/frame-clock';

/**
 * Main-thread replacement for Tailwind's `animate-pulse` on streaming
 * operational-row icons: same 2 s ease-in-out dip to 50 % opacity, but written
 * as an inline style from the shared 30 fps clock (quantised so a slot writes
 * only when the value changes) instead of a compositor opacity animation. A
 * compositor animation inside the chat panel's nested rounded clips forces
 * masked render surfaces that are re-drawn every vsync; an inline style does
 * not promote a layer, so the compositor draws only when the value changes.
 * Under `prefers-reduced-motion: reduce` the driver stays off and the icon
 * holds its normal opacity, as the stylesheet froze `animate-pulse` before.
 */
export const STREAMING_PULSE_PERIOD_MS = 2_000;
export const STREAMING_PULSE_STEP = 0.05;

function cubicBezierY(x: number, x1: number, y1: number, x2: number, y2: number): number {
  const sample = (t: number, first: number, second: number) =>
    3 * (1 - t) * (1 - t) * t * first + 3 * (1 - t) * t * t * second + t ** 3;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (sample(midpoint, x1, x2) < x) low = midpoint;
    else high = midpoint;
  }
  return sample((low + high) / 2, y1, y2);
}

/** Opacity of the pulse at `timeMs`, quantised to `STREAMING_PULSE_STEP`. */
export function streamingPulseOpacity(timeMs: number): number {
  const position = (((timeMs / STREAMING_PULSE_PERIOD_MS) % 1) + 1) % 1;
  const dipping = position < 0.5;
  const progress = cubicBezierY((dipping ? position : position - 0.5) * 2, 0.4, 0, 0.6, 1);
  const opacity = dipping ? 1 - 0.5 * progress : 0.5 + 0.5 * progress;
  return Math.round(opacity / STREAMING_PULSE_STEP) * STREAMING_PULSE_STEP;
}

export const streamingPulse: Action<HTMLElement, boolean> = (node, streaming) => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = streaming;
  let stop: (() => void) | undefined;
  let written: string | undefined;

  const write = (frameTimeMs: number) => {
    const value = String(streamingPulseOpacity(frameTimeMs));
    if (value === written) return;
    written = value;
    node.style.opacity = value;
  };

  const reconcile = () => {
    if (active) node.dataset.streamingPulse = '';
    else delete node.dataset.streamingPulse;
    const drive = active && !media.matches;
    if (drive && !stop) {
      write(currentFrameTime());
      stop = subscribeFrameClock(write);
    } else if (!drive && stop) {
      stop();
      stop = undefined;
      written = undefined;
      node.style.opacity = '';
    }
  };

  media.addEventListener('change', reconcile);
  reconcile();
  return {
    update: (streaming) => {
      active = streaming;
      reconcile();
    },
    destroy: () => {
      media.removeEventListener('change', reconcile);
      active = false;
      reconcile();
    },
  };
};

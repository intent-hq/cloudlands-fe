import { quintOut } from 'svelte/easing';
import { crossfade as svelteCrossfade } from 'svelte/transition';

/**
 * Creates a crossfade transition for smoothly animating elements between positions
 *
 * @param duration - Duration of the transition in milliseconds
 * @param delay - Delay before the transition starts in milliseconds
 * @returns A tuple of [send, receive] functions for the crossfade
 */
export function createCrossfade(duration = 400, delay = 0) {
  return svelteCrossfade({
    duration,
    delay,
    easing: quintOut,
    fallback(node, params) {
      const style = getComputedStyle(node);
      const transform = style.transform === 'none' ? '' : style.transform;

      return {
        duration,
        easing: quintOut,
        css: (t) => `
          transform: ${transform} scale(${t});
          opacity: ${t}
        `,
      };
    },
  });
}

/**
 * Default crossfade for general use
 */
export const [send, receive] = createCrossfade();

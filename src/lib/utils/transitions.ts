/**
 * Svelte animation utilities for smooth transitions
 * Provides reusable animation configurations for common UI patterns
 */

import { crossfade, type CrossfadeParams } from 'svelte/transition';
import { quintOut } from 'svelte/easing';

/**
 * Creates a crossfade transition for items moving between lists
 * Used when items are added/removed from the DOM (e.g., moving between columns)
 *
 * @param duration - Animation duration in milliseconds (default: 300)
 * @returns Object with send and receive transition functions
 *
 * @example
 * ```svelte
 * <script>
 *   import { cardCrossfade } from '$lib/utils/transitions';
 *   const { send, receive } = cardCrossfade(300);
 * </script>
 *
 * {#each items as item (item.id)}
 *   <div in:receive out:send animate:flip={{ duration: 300 }}>
 *     {item.name}
 *   </div>
 * {/each}
 * ```
 */
export function cardCrossfade(duration = 300) {
  const params: CrossfadeParams = {
    duration,
    easing: quintOut,
  };

  return crossfade(params);
}

/**
 * Flip animation configuration for list items
 * Used with animate:flip directive to smoothly animate position changes
 * when items reorder within a keyed #each block
 *
 * @param duration - Animation duration in milliseconds (default: 300)
 * @returns Animation configuration object
 *
 * @example
 * ```svelte
 * {#each items as item (item.id)}
 *   <div animate:flip={flipConfig(300)}>
 *     {item.name}
 *   </div>
 * {/each}
 * ```
 */
export function flipConfig(duration = 300) {
  return { duration, easing: quintOut };
}

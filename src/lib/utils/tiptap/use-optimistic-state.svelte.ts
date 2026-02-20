/**
 * Utility for optimistic UI updates in TipTap node views
 *
 * Provides temporary state that overrides actual state until cleared.
 * Useful for immediate UI feedback while waiting for async ProseMirror transactions.
 */

/**
 * Hook for optimistic UI updates
 *
 * Provides temporary state that overrides actual state until cleared.
 * Automatically clears after a specified delay to sync with actual state.
 *
 * @param clearDelay - Milliseconds to wait before clearing optimistic state (default: 50)
 * @returns Object with optimistic state management methods
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useOptimisticState } from "$lib/utils/tiptap/use-optimistic-state.svelte";
 *   import { useReactiveNode } from "$lib/utils/tiptap/use-reactive-node.svelte";
 *
 *   let { node, editor, getPos } = $props();
 *
 *   const reactiveNode = useReactiveNode(node, editor, getPos);
 *   const optimistic = useOptimisticState<{ checked: boolean; status: string }>();
 *
 *   // Derive final state (optimistic overrides actual)
 *   let checked = $derived(optimistic.get('checked') ?? reactiveNode.value.attrs.checked);
 *   let status = $derived(optimistic.get('status') ?? reactiveNode.value.attrs.status);
 *
 *   function handleClick() {
 *     // Set optimistic state for immediate feedback
 *     optimistic.set({ checked: true, status: 'done' });
 *
 *     // Update actual state (async)
 *     updateNodeAttributes(editor, getPos, reactiveNode.value, {
 *       checked: true,
 *       status: 'done'
 *     });
 *
 *     // Optimistic state auto-clears after 50ms
 *   }
 * </script>
 *
 * <input type="checkbox" {checked} onclick={handleClick} />
 * ```
 */
export function useOptimisticState<T extends Record<string, any>>(clearDelay: number = 50) {
  let optimisticState = $state<Partial<T>>({});
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set optimistic state values
   *
   * Merges with existing optimistic state and schedules auto-clear.
   *
   * @param updates - Partial state updates
   */
  function set(updates: Partial<T>) {
    optimisticState = { ...optimisticState, ...updates };

    // Clear previous timer
    if (clearTimer) clearTimeout(clearTimer);

    // Set new timer to clear optimistic state
    clearTimer = setTimeout(() => {
      optimisticState = {};
      clearTimer = null;
    }, clearDelay);
  }

  /**
   * Get a specific optimistic state value
   *
   * Returns undefined if the key is not in optimistic state.
   * Use with nullish coalescing to fall back to actual state:
   * `optimistic.get('checked') ?? node.attrs.checked`
   *
   * @param key - State key to get
   * @returns Optimistic value or undefined
   */
  function get<K extends keyof T>(key: K): T[K] | undefined {
    return optimisticState[key];
  }

  /**
   * Manually clear all optimistic state
   *
   * Cancels any pending auto-clear timer.
   */
  function clear() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    optimisticState = {};
  }

  /**
   * Check if a specific key has optimistic state
   *
   * @param key - State key to check
   * @returns Whether the key has optimistic state
   */
  function has<K extends keyof T>(key: K): boolean {
    return key in optimisticState;
  }

  return {
    set,
    get,
    clear,
    has,
    /**
     * Get the entire optimistic state object
     *
     * Useful for debugging or advanced use cases.
     */
    get state() {
      return optimisticState;
    },
  };
}

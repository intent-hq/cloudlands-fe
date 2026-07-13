/**
 * Utility for optimistic UI updates in TipTap node views
 *
 * Provides temporary state that overrides actual state until the BE
 * confirms or rejects the corresponding mutation. The optimistic overlay
 * persists indefinitely — there is no time-based auto-clear — and the
 * caller is responsible for invoking `commit()` on a successful BE
 * response or `rollback()` on a failed one.
 */

/**
 * Hook for optimistic UI updates
 *
 * Provides temporary state that overrides actual state until cleared by
 * the caller in response to the BE's mutation result.
 *
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
 *   async function handleClick() {
 *     // Set optimistic state for immediate feedback
 *     optimistic.set({ checked: true, status: 'done' });
 *     try {
 *       // Await the BE mutation (e.g. an IPC call backing a `note:*` event)
 *       await updateNodeAttributes(editor, getPos, reactiveNode.value, {
 *         checked: true,
 *         status: 'done',
 *       });
 *       // BE accepted the mutation — drop the overlay so the actual
 *       // (now-updated) attrs render through.
 *       optimistic.commit();
 *     } catch (err) {
 *       // BE rejected the mutation — drop the overlay so the previous
 *       // attrs render through again.
 *       optimistic.rollback();
 *     }
 *   }
 * </script>
 *
 * <input type="checkbox" {checked} onclick={handleClick} />
 * ```
 */
export function useOptimisticState<T extends Record<string, any>>() {
  let optimisticState = $state<Partial<T>>({});

  /**
   * Set optimistic state values
   *
   * Merges with existing optimistic state. The overlay persists until
   * `commit()`, `rollback()`, or `clear()` is called — there is no
   * time-based auto-clear.
   *
   * @param updates - Partial state updates
   */
  function set(updates: Partial<T>) {
    optimisticState = { ...optimisticState, ...updates };
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

  function clearKeys(keys?: ReadonlyArray<keyof T>) {
    if (!keys) {
      optimisticState = {};
      return;
    }
    const next: Partial<T> = { ...optimisticState };
    for (const key of keys) {
      delete next[key];
    }
    optimisticState = next;
  }

  /**
   * Drop the optimistic overlay after the BE has accepted the mutation.
   *
   * The actual (now-updated) state takes over because the overlay no
   * longer shadows it. Pass `keys` to commit only a subset.
   */
  function commit(keys?: ReadonlyArray<keyof T>) {
    clearKeys(keys);
  }

  /**
   * Drop the optimistic overlay after the BE has rejected the mutation.
   *
   * The previous actual state takes over because the overlay no longer
   * shadows it. Pass `keys` to roll back only a subset.
   */
  function rollback(keys?: ReadonlyArray<keyof T>) {
    clearKeys(keys);
  }

  /**
   * Manually clear all optimistic state.
   *
   * Equivalent to `commit()` / `rollback()` with no keys — kept as a
   * generic alias for callers that aren't reconciling against a BE
   * response (e.g. component teardown).
   */
  function clear() {
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
    commit,
    rollback,
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

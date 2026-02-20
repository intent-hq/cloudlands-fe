/**
 * useURLState Hook
 *
 * Svelte 5 hook for managing URL state with automatic syncing.
 *
 * Usage:
 * ```typescript
 * const { state, setState, clearState } = useURLState({
 *   selectedNote: { type: 'string', default: null },
 *   mainContentType: { type: 'string', default: 'empty' },
 * });
 *
 * // Get state
 * $effect(() => {
 *   logger.info('Selected note:', state.selectedNote);
 * });
 *
 * // Update state
 * await setState({ selectedNote: 'note-123' });
 * ```
 */

import { URLStateManager, type URLStateDefinition } from '$lib/utils/url-state';
import { page } from '$app/stores';
import { get } from 'svelte/store';

export interface UseURLStateOptions {
  prefix?: string;
  replaceHistory?: boolean;
}

export function useURLState(definition: URLStateDefinition, options: UseURLStateOptions = {}) {
  const manager = new URLStateManager(definition, options.prefix);

  // Create reactive state object
  let state = $state<Record<string, any>>(manager.getState());

  // Sync state when URL changes
  // We need to subscribe to the page store to make this reactive to URL changes
  $effect(() => {
    // Subscribe to page store to trigger when URL changes
    const unsubscribe = page.subscribe(($page) => {
      const newState = manager.getState();
      state = newState;
    });

    return unsubscribe;
  });

  return {
    get state() {
      return state;
    },

    async setState(updates: Record<string, any>) {
      await manager.setState(updates, {
        replace: options.replaceHistory,
      });
      // Update local state immediately for responsiveness
      state = { ...state, ...updates };
    },

    async clearState(keys?: string[]) {
      await manager.clearState(keys);
      state = manager.getState();
    },

    getValue<T = any>(key: string): T | undefined {
      return state[key] as T;
    },
  };
}

/**
 * Two-way binding helper
 *
 * Usage:
 * ```typescript
 * const { state, bind } = useURLStateBinding({
 *   selectedNote: { type: 'string', default: null },
 * });
 *
 * // In template:
 * <input bind:value={bind.selectedNote} />
 * ```
 */
export function useURLStateBinding(
  definition: URLStateDefinition,
  options: UseURLStateOptions = {},
) {
  const { state, setState } = useURLState(definition, options);

  // Create proxy for two-way binding
  const bind = new Proxy(state, {
    get(target, prop: string) {
      return target[prop];
    },
    set(target, prop: string, value) {
      setState({ [prop]: value });
      return true;
    },
  });

  return { state, bind };
}

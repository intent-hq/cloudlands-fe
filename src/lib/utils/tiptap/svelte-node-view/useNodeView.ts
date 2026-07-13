/**
 * Hooks to access TipTap node view context within Svelte components
 *
 * With the svelte-tiptap style implementation, props are passed directly
 * to components and are reactive via $state. These hooks provide access
 * to the context for drag handling.
 */

import { getContext } from 'svelte';
import {
  NODE_VIEW_CONTEXT_KEY,
  type NodeViewContext,
} from './context';

/**
 * Get the node view context
 *
 * With the new svelte-tiptap style implementation, NodeViewProps are passed
 * directly to components as reactive props. This hook is primarily useful
 * for accessing the drag handler.
 *
 * @returns The NodeViewContext with onDragStart handler
 * @throws Error if called outside of a SvelteNodeViewRenderer component
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import type { NodeViewProps } from '@tiptap/core';
 *   import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
 *
 *   // Props are passed directly and are reactive
 *   let { node, selected, updateAttributes }: NodeViewProps = $props();
 *
 *   // Access attrs reactively
 *   let checked = $derived(node.attrs.checked);
 * </script>
 *
 * <NodeViewWrapper>
 *   <input type="checkbox" checked={checked} onclick={() => updateAttributes({ checked: !checked })} />
 * </NodeViewWrapper>
 * ```
 */
export function useNodeViewContext(): NodeViewContext {
  const context = getContext<NodeViewContext | undefined>(NODE_VIEW_CONTEXT_KEY);

  if (!context) {
    throw new Error(
      'useNodeViewContext() must be called within a component rendered by SvelteNodeViewRenderer.',
    );
  }

  return context;
}

/**
 * @deprecated Use component props directly instead. Props are now passed to
 * components and are reactive via $state.
 */
export function useNodeView(): never {
  throw new Error(
    'useNodeView() is deprecated. Props are now passed directly to your component. ' +
      'Use `let { node, selected, updateAttributes, ... }: NodeViewProps = $props();`',
  );
}

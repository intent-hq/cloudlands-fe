/**
 * Utility to work around svelte-tiptap's reactivity bug
 *
 * svelte-tiptap's SvelteNodeViewRenderer doesn't properly implement ProseMirror's
 * node view update() lifecycle method, so Svelte components don't re-render when
 * node attributes change via ProseMirror transactions.
 *
 * This utility manually subscribes to editor updates and tracks the current node state,
 * triggering Svelte's reactivity system when attributes change.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { onMount } from 'svelte';

/**
 * Hook to work around svelte-tiptap's reactivity bug
 *
 * Manually subscribes to editor updates and tracks the current node state.
 * Returns a reactive wrapper that updates when node attributes change.
 *
 * @param node - Initial node from svelte-tiptap props
 * @param editor - TipTap editor instance
 * @param getPos - Function to get current node position
 * @param attributeKeys - Optional array of attribute keys to watch for changes.
 *                        If not provided, watches all attributes (slower but safer).
 * @returns Reactive node wrapper with `value` and `updateCounter` properties
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useReactiveNode } from "$lib/utils/tiptap/use-reactive-node.svelte";
 *
 *   let { node, editor, getPos } = $props();
 *
 *   // Track node reactively, watching specific attributes
 *   const reactiveNode = useReactiveNode(node, editor, getPos, ['checked', 'status']);
 *
 *   // Derive state from reactive node
 *   let checked = $derived(reactiveNode.value.attrs.checked);
 *   let status = $derived(reactiveNode.value.attrs.status);
 * </script>
 *
 * <input type="checkbox" {checked} />
 * ```
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   // Watch all attributes (use when you don't know which will change)
 *   const reactiveNode = useReactiveNode(node, editor, getPos);
 *
 *   // Access any attribute
 *   let anyAttr = $derived(reactiveNode.value.attrs.someAttr);
 * </script>
 * ```
 */
export function useReactiveNode(
  node: ProseMirrorNode | undefined,
  editor: Editor | undefined,
  getPos: () => number | undefined,
  attributeKeys?: string[],
) {
  let currentNode = $state<ProseMirrorNode | undefined>(node);
  let updateCounter = $state(0);

  onMount(() => {
    // Guard against undefined editor
    if (!editor) return;

    const handleUpdate = () => {
      const pos = getPos();
      if (typeof pos !== 'number') return;

      try {
        const updatedNode = editor.state.doc.nodeAt(pos);
        if (!updatedNode || !currentNode || updatedNode.type !== currentNode.type) return;

        // Check if any watched attributes changed
        const hasChanges = attributeKeys
          ? attributeKeys.some((key) => updatedNode.attrs[key] !== currentNode!.attrs[key])
          : JSON.stringify(updatedNode.attrs) !== JSON.stringify(currentNode!.attrs);

        if (hasChanges) {
          currentNode = updatedNode;
          updateCounter++; // Force reactivity
        }
      } catch (error) {
        // Node might have been deleted
        console.debug('[useReactiveNode] Node not found at position', pos, error);
      }
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
    };
  });

  return {
    /**
     * Get the current node
     *
     * Access updateCounter to ensure reactivity when used in $derived.
     */
    get value() {
      // Access updateCounter to ensure reactivity (intentional unused expression)
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      updateCounter;
      return currentNode;
    },
    /**
     * Get the update counter
     *
     * Increments each time the node attributes change.
     * Useful for forcing effects to re-run.
     */
    get updateCounter() {
      return updateCounter;
    },
  };
}

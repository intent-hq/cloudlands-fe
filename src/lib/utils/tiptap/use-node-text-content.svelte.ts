/**
 * Utility for extracting text content from TipTap nodes
 *
 * Provides a reactive way to get text content from a ProseMirror node,
 * handling position validation and error cases.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';

/**
 * Get text content from a ProseMirror node
 *
 * Returns a reactive derived value that extracts text content from the node.
 * Automatically handles position validation and errors.
 *
 * Note: This must be called within a Svelte component context to use $derived.
 *
 * @param node - ProseMirror node (can be reactive)
 * @param editor - TipTap editor instance
 * @param getPos - Function to get current node position
 * @param separator - Separator for block nodes (default: " ")
 * @returns Reactive text content string
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useReactiveNode } from "$lib/utils/tiptap/use-reactive-node.svelte";
 *   import { useNodeTextContent } from "$lib/utils/tiptap/use-node-text-content.svelte";
 *
 *   let { node, editor, getPos } = $props();
 *
 *   const reactiveNode = useReactiveNode(node, editor, getPos);
 *   const textContent = useNodeTextContent(reactiveNode.value, editor, getPos);
 * </script>
 *
 * <button data-text={textContent}>
 *   <!-- textContent automatically updates when node changes -->
 * </button>
 * ```
 */
export function useNodeTextContent(
  node: ProseMirrorNode,
  editor: Editor,
  getPos: () => number | undefined,
  separator: string = ' ',
) {
  // Create a reactive getter that can be used in $derived context
  let textContent = $state('');

  $effect(() => {
    const pos = getPos();
    if (typeof pos !== 'number') {
      textContent = '';
      return;
    }

    try {
      textContent = editor.state.doc.textBetween(pos, pos + node.nodeSize, separator, separator);
    } catch (error) {
      // Node might have been deleted or position is invalid
      console.debug('[useNodeTextContent] Error getting text content:', error);
      textContent = '';
    }
  });

  return {
    get value() {
      return textContent;
    },
  };
}

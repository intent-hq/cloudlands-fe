/**
 * Context key and types for Svelte TipTap node views
 * Matches the svelte-tiptap library API
 */

/**
 * Context key for accessing node view state
 */
export const NODE_VIEW_CONTEXT_KEY = 'TipTapNodeView';

/**
 * Context value type
 */
export interface NodeViewContext {
  onDragStart: (event: DragEvent) => void;
  contentDOMElement: HTMLElement | null;
}

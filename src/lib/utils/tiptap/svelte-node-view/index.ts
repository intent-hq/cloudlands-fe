/**
 * Svelte Node View System for TipTap
 *
 * A Svelte 5 compatible system for rendering Svelte components
 * as TipTap/ProseMirror node views with proper reactivity.
 *
 * Mimics the svelte-tiptap library API.
 * @see https://github.com/sibiraj-s/svelte-tiptap
 *
 * @example
 * ```typescript
 * // In your TipTap extension:
 * import {
  SvelteNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from '$lib/utils/tiptap/svelte-node-view';
 * import MyNodeView from './MyNodeView.svelte';
 *
 * export const MyNode = Node.create({
 *   name: 'myNode',
 *   addNodeView() {
 *     return SvelteNodeViewRenderer(MyNodeView);
 *   },
 * });
 * ```
 *
 * @example
 * ```svelte
 * <!-- In your Svelte node view component: -->
 * <script lang="ts">
 *   import type { NodeViewProps } from '@tiptap/core';
 *
 *
 *   // Props are passed directly and are reactive via $state
 *   let { node, selected, updateAttributes }: NodeViewProps = $props();
 *
 *   // Derive reactive values from props
 *   let title = $derived(node.attrs.title);
 * </script>
 *
 * <NodeViewWrapper class="my-node">
 *   <h3>{title}</h3>
 *   <NodeViewContent />
 * </NodeViewWrapper>
 * ```
 */

// Main renderer
export { SvelteNodeViewRenderer } from './SvelteNodeViewRenderer.svelte';
export type { SvelteNodeViewRendererOptions } from './SvelteNodeViewRenderer.svelte';

// Components
export { default as NodeViewWrapper } from './NodeViewWrapper.svelte';
export { default as NodeViewContent } from './NodeViewContent.svelte';

// Hooks
export { useNodeViewContext } from './useNodeView';

// Types and context
export { NODE_VIEW_CONTEXT_KEY, type NodeViewContext } from './context';

<!--
  NodeViewWrapper - Container component for TipTap Svelte node views

  This component wraps your node view content and handles:
  - Proper data attributes for TipTap
  - Drag start handling for node dragging
  - CSS class application

  Matches the svelte-tiptap library API.

  @example
  ```svelte
  <script>
    import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  </script>

  <NodeViewWrapper as="div" class="my-custom-class">
    <p>Node content here</p>
  </NodeViewWrapper>
  ```
-->
<script lang="ts" generics="T extends keyof SvelteHTMLElements = 'div'">
  import { getContext, onMount, tick } from 'svelte';
  import type { SvelteHTMLElements } from 'svelte/elements';
  import { NODE_VIEW_CONTEXT_KEY, type NodeViewContext } from './context';

  type Props = SvelteHTMLElements[T] & {
    as?: T;
  };

  const { as = 'div' as T, children, ...rest }: Props = $props();

  const context = getContext<NodeViewContext | undefined>(NODE_VIEW_CONTEXT_KEY);
  let element: HTMLElement;

  onMount(async () => {
    await tick();
    element.style.whiteSpace = 'normal';
  });
</script>

<svelte:element
  this={as}
  bind:this={element}
  data-node-view-wrapper=""
  role="none"
  {...rest}
  ondragstart={context?.onDragStart}
>
  {#if children}
    {@render children()}
  {/if}
</svelte:element>

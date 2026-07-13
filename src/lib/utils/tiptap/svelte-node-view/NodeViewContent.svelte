<!--
  NodeViewContent - Container for ProseMirror contentDOM placement

  The SvelteNodeViewRenderer will append the contentDOM element inside
  any element with the data-node-view-content attribute.

  This component also actively retrieves the contentDOMElement from context
  and appends it on mount, which handles HMR scenarios where the component
  is recreated but ProseMirror's update() is not called.

  Matches the svelte-tiptap library API.
-->
<script lang="ts" generics="T extends keyof SvelteHTMLElements = 'div'">
  import {
  onMount,
  tick,
  getContext,
} from 'svelte';
  import type { SvelteHTMLElements } from 'svelte/elements';
  import {
  NODE_VIEW_CONTEXT_KEY,
  type NodeViewContext,
} from './context';

  type Props = SvelteHTMLElements[T] & {
    as?: T;
  };

  const { as = 'div' as T, children, ...rest }: Props = $props();

  let element: HTMLElement;

  // Get the contentDOMElement from context (set by SvelteNodeViewRenderer)
  const nodeViewContext = getContext<NodeViewContext>(NODE_VIEW_CONTEXT_KEY);

  onMount(async () => {
    await tick();
    element.style.whiteSpace = 'pre-wrap';

    // Actively append the contentDOMElement if it exists and isn't already a child.
    // This handles HMR scenarios where the Svelte component is recreated
    // but ProseMirror's update() is not called.
    if (
      nodeViewContext?.contentDOMElement &&
      !element.contains(nodeViewContext.contentDOMElement)
    ) {
      element.appendChild(nodeViewContext.contentDOMElement);
    }
  });
</script>

<svelte:element this={as} bind:this={element} data-node-view-content {...rest}>
  {#if children}
    {@render children()}
  {/if}
</svelte:element>

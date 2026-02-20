<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    target?: string | HTMLElement;
    zIndex?: number;
    children: Snippet;
  }

  let { target = 'body', zIndex = 10, children }: Props = $props();

  let portalElement: HTMLDivElement;
  let mounted = $state(false);

  onMount(() => {
    // Find the target element
    let targetElement: HTMLElement | null;
    if (typeof target === 'string') {
      targetElement = document.querySelector(target);
    } else {
      targetElement = target;
    }

    // Fallback to body if target not found
    if (!targetElement) {
      targetElement = document.body;
    }

    // Create portal container
    portalElement = document.createElement('div');
    portalElement.className = 'portal-container';
    // Use the provided z-index or default to 10
    portalElement.style.zIndex = String(zIndex);
    portalElement.style.position = 'relative';

    // Append to target
    targetElement.appendChild(portalElement);
    mounted = true;

    // Cleanup function
    return () => {
      if (portalElement && portalElement.parentNode) {
        portalElement.parentNode.removeChild(portalElement);
      }
    };
  });

  function portal(node: HTMLElement) {
    if (portalElement) {
      portalElement.appendChild(node);
    }

    return {
      destroy() {
        if (node && node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }
</script>

<!-- Render content into the portal element using a custom action -->
{#if mounted}
  <div use:portal>
    {@render children()}
  </div>
{/if}

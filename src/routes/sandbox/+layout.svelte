<script lang="ts">
  import '@fontsource-variable/inter';
  import { onMount, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import CatalogShell from '$lib/component-catalog/CatalogShell.svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  const activeSlug = $derived((page.params as { slug?: string }).slug);

  // The stylesheet rule below shares specificity with the token defaults, so which one wins
  // depends on stylesheet order. The inline declaration makes the bundled face win regardless;
  // CatalogShell only touches root inline properties it owns, so this survives theme updates.
  onMount(() => {
    const root = document.documentElement;
    const priorValue = root.style.getPropertyValue('--font-ui');
    const priorPriority = root.style.getPropertyPriority('--font-ui');
    root.style.setProperty(
      '--font-ui',
      "'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
    return () => {
      if (priorValue) root.style.setProperty('--font-ui', priorValue, priorPriority);
      else root.style.removeProperty('--font-ui');
    };
  });
</script>

<svelte:head>
  <title>Component sandbox</title>
</svelte:head>

<CatalogShell {activeSlug}>{@render children?.()}</CatalogShell>

<style>
  :global(:root) {
    --font-ui:
      'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
</style>

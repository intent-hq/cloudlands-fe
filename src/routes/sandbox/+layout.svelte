<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import CatalogShell from '$lib/component-catalog/CatalogShell.svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  const activeSlug = $derived((page.params as { slug?: string }).slug);
</script>

<svelte:head>
  <title>Component sandbox</title>
</svelte:head>

<CatalogShell {activeSlug}>{@render children?.()}</CatalogShell>

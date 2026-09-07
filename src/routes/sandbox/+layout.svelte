<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import CatalogShell from '$lib/component-catalog/CatalogShell.svelte';
  import { Toast } from '$lib/components/ui/toast';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  const activeSlug = $derived((page.params as { slug?: string }).slug);
  const activePath = $derived(page.url.pathname);
</script>

<svelte:head>
  <title>Component sandbox</title>
</svelte:head>

<CatalogShell {activeSlug} {activePath}>{@render children?.()}</CatalogShell>
<Toast />

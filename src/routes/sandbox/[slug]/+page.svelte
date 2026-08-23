<script lang="ts">
  import { page } from '$app/state';
  import CatalogFixtureList from '$lib/component-catalog/CatalogFixtureList.svelte';
  import CatalogScene from '$lib/component-catalog/CatalogScene.svelte';
  import { getCatalogEntry } from '$lib/component-catalog/catalog';
  import { parseCatalogUrlSettings } from '$lib/component-catalog/catalog-preferences';

  const slug = $derived((page.params as { slug: string }).slug);
  const entry = $derived(getCatalogEntry(slug));
  const urlSettings = $derived(parseCatalogUrlSettings(page.url.searchParams));
</script>

{#if urlSettings.state}
  <CatalogScene {slug} requestedState={urlSettings.state} requestedWidth={urlSettings.width} />
{:else if entry}
  <CatalogFixtureList {entry} />
{:else}
  <section class="mx-auto max-w-3xl space-y-4 p-6 lg:p-10">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Catalog entry</p>
    <h1 class="text-3xl font-semibold tracking-tight">Fixture not found</h1>
    <p class="text-muted-foreground">This slug is not present in the static catalog registry.</p>
    <a class="text-sm font-medium text-primary underline" href="/sandbox">Back to catalog</a>
  </section>
{/if}

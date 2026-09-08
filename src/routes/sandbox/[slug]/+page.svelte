<script lang="ts">
  import type { Component } from 'svelte';
  import { page } from '$app/state';
  import CatalogScene from '$lib/component-catalog/CatalogScene.svelte';
  import type { CatalogEntry } from '$lib/component-catalog/catalog';
  import { parseCatalogUrlSettings } from '$lib/component-catalog/catalog-preferences';

  interface LegacyCatalogDetail {
    component: Component<{ entry: CatalogEntry }>;
    entry?: CatalogEntry;
  }

  async function loadLegacyCatalogDetail(slug: string): Promise<LegacyCatalogDetail> {
    const [{ default: component }, { getCatalogEntry }] = await Promise.all([
      import('$lib/component-catalog/CatalogFixtureList.svelte'),
      import('$lib/component-catalog/catalog'),
    ]);
    return { component, entry: getCatalogEntry(slug) };
  }

  const slug = $derived((page.params as { slug: string }).slug);
  const urlSettings = $derived(parseCatalogUrlSettings(page.url.searchParams));
  const legacyDetail = $derived(urlSettings.state ? undefined : loadLegacyCatalogDetail(slug));
</script>

{#if urlSettings.state}
  <CatalogScene
    {slug}
    requestedState={urlSettings.state}
    requestedWidth={urlSettings.width}
    requestedFit={urlSettings.fit}
  />
{:else}
  {#await legacyDetail then detail}
    {#if detail?.entry}
      {@const CatalogFixtureList = detail.component}
      <CatalogFixtureList entry={detail.entry} />
    {:else}
      <section class="mx-auto max-w-3xl space-y-4 p-6 lg:p-10">
        <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Catalog entry
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">Fixture not found</h1>
        <p class="text-muted-foreground">
          This slug is not present in the static catalog registry.
        </p>
        <a class="text-sm font-medium text-primary underline" href="/sandbox">Back to catalog</a>
      </section>
    {/if}
  {/await}
{/if}

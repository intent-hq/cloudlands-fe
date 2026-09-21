<script lang="ts">
  import CatalogFixtureList from '$lib/component-catalog/CatalogFixtureList.svelte';
  import { getCatalogEntry } from '$lib/component-catalog/catalog';

  const entry = getCatalogEntry('modals');
</script>

{#if entry}
  <CatalogFixtureList {entry} />
{/if}

<script lang="ts">
  import CatalogFixtureList from '$lib/component-catalog/CatalogFixtureList.svelte';
  import { getCatalogEntry } from '$lib/component-catalog/catalog';

  const entry = getCatalogEntry('fields');
</script>

{#if entry}
  <CatalogFixtureList {entry} />
{/if}

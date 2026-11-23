<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setSettingsSearchQuery } from './settings-search-context';

  let { query, children }: { query: string; children: Snippet } = $props();

  setSettingsSearchQuery(() => query);
</script>

{@render children()}

<script lang="ts">
  import ListRow from './ListRow.svelte';
  import ListView from './ListView.svelte';

  let { count = 0, status = 'ready' }: { count?: number; status?: 'ready' | 'loading' | 'error' } =
    $props();
  const items = $derived(
    Array.from({ length: count }, (_, index) => ({ id: index, label: `Row ${index}` })),
  );
</script>

<ListView {items} getKey={(item) => item.id} getText={(item) => item.label} {status} class="h-48">
  {#snippet row({ item })}
    <ListRow>{#snippet title()}{item.label}{/snippet}</ListRow>
  {/snippet}
</ListView>

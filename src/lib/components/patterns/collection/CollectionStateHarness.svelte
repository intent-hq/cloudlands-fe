<script lang="ts">
  import ListRow from './ListRow.svelte';
  import ListView from './ListView.svelte';
  import type { ListKey } from './types';

  let {
    count = 0,
    status = 'ready',
    selectable = false,
  }: {
    count?: number;
    status?: 'ready' | 'loading' | 'error';
    selectable?: false | 'single' | 'multi';
  } = $props();
  let selectedKeys = $state<ListKey[]>([]);
  const items = $derived(
    Array.from({ length: count }, (_, index) => ({ id: index, label: `Row ${index}` })),
  );
</script>

<ListView
  {items}
  getKey={(item) => item.id}
  getText={(item) => item.label}
  {status}
  {selectable}
  {selectedKeys}
  onSelectedKeysChange={(keys) => (selectedKeys = keys)}
  class="h-48"
>
  {#snippet row({ item })}
    <ListRow>{#snippet title()}{item.label}{/snippet}</ListRow>
  {/snippet}
</ListView>

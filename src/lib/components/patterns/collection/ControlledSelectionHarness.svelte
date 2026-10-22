<script lang="ts">
  import ListRow from './ListRow.svelte';
  import ListView from './ListView.svelte';
  import type { ListKey } from './types';

  let {
    reportChanges = true,
  }: {
    /** When false the owner ignores both selection-change reports and activation. */
    reportChanges?: boolean;
  } = $props();

  const items = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
    { id: 'gamma', name: 'Gamma' },
  ];
  // Like Home's view state or the GitLab picker's prop chain, the owner's selection reaches
  // ListView through a derived that only notifies when its value changes. Clearing and
  // re-setting it within one frame therefore leaves `selectedKeys` untouched.
  let view = $state<{ selectedId: string | null }>({ selectedId: 'beta' });
  const selectedId = $derived(view.selectedId);

  function select(id: string | null) {
    view = { selectedId: id };
  }

  function onSelectedKeysChange(keys: ListKey[]) {
    select(keys[0] === undefined ? null : String(keys[0]));
  }
</script>

<!-- One-way owner: a click on the selected row reports [] and onActivate re-selects it in the same frame. -->
<ListView
  {items}
  getKey={(item) => item.id}
  getText={(item) => item.name}
  selectable="single"
  selectedKeys={selectedId ? [selectedId] : []}
  onSelectedKeysChange={reportChanges ? onSelectedKeysChange : undefined}
  onActivate={(item) => {
    if (reportChanges) select(item.id);
  }}
  ariaLabel="Controlled selection"
>
  {#snippet row({ item })}
    <ListRow>{#snippet title()}{item.name}{/snippet}</ListRow>
  {/snippet}
</ListView>

<output aria-label="Owner selection">{selectedId ?? 'none'}</output>

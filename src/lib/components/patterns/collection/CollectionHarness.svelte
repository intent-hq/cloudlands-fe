<script lang="ts">
  import ListRow from './ListRow.svelte';
  import ListView from './ListView.svelte';
  import RowActions from './RowActions.svelte';

  const items = [
    { id: 'alpha', name: 'Alpha', description: 'First item' },
    { id: 'beta', name: 'Beta', description: 'Second item' },
    { id: 'bravo', name: 'Bravo', description: 'Third item' },
  ];
  let selectedKeys = $state<(string | number)[]>(['beta', 'bravo']);
  let actionCount = $state(0);
</script>

<ListView
  {items}
  getKey={(item) => item.id}
  getText={(item) => item.name}
  selectable="multi"
  bind:selectedKeys
  ariaLabel="Test collection"
>
  {#snippet row({ item })}
    <ListRow>
      {#snippet title()}{item.name}{/snippet}
      {#snippet description()}{item.description}{/snippet}
      {#snippet trailing()}
        <RowActions
          actions={[
            {
              label: `Act on ${item.name}`,
              icon: actionIcon,
              onSelect: () => (actionCount += 1),
            },
          ]}
        />
      {/snippet}
    </ListRow>
  {/snippet}
</ListView>

{#snippet actionIcon()}<span aria-hidden="true">+</span>{/snippet}
<output aria-label="Action count">{actionCount}</output>

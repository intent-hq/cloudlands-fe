<script lang="ts">
  import { faEllipsis, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { Input } from '$lib/components/ui/input';
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
  let lastAction = $state('none');
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
        <Input aria-label={`Edit ${item.name}`} />
        <RowActions
          actions={[
            {
              id: 'act',
              label: `Act on ${item.name}`,
              icon: faPlus,
            },
            {
              id: 'details',
              label: `More about ${item.name}`,
              icon: faEllipsis,
              shortcut: '⌘I',
              checked: true,
            },
            {
              id: 'delete',
              label: `Delete ${item.name}`,
              icon: faTrash,
              destructive: true,
            },
          ]}
          visibleCount={1}
          overflowLabel={`More actions for ${item.name}`}
          onAction={(id) => {
            lastAction = id;
            if (id === 'act') actionCount += 1;
          }}
        />
      {/snippet}
    </ListRow>
  {/snippet}
</ListView>

<output aria-label="Action count">{actionCount}</output>
<output aria-label="Last action">{lastAction}</output>

<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'list-labels',
    title: 'List label typography',
    defaultState: 'selected',
    states: { selected: { props: {} } },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { ListContainer, ListItem } from '$lib/components/ui/list';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import * as Menu from '$lib/components/ui/menu';
  import { Button } from '$lib/components/ui/button';
  import { selectActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import WorkspaceShellList from './WorkspaceShellList.svelte';
  import { LIST_LABELS_WORKSPACE, setupListLabelsPreview } from './list-labels.preview-fixtures';

  onMount(setupListLabelsPreview);
  const activeTab$ = selectActiveTab(LIST_LABELS_WORKSPACE);
  const items = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ];
  let selected = $state('alpha');
  let selectedKeys = $state<(string | number)[]>(['beta']);
  let navigation = $state('Overview');
  let action = $state('none');
  let ordinaryCount = $state(0);
</script>

<section
  class="grid w-full gap-6 bg-background p-4 text-foreground"
  data-testid="list-labels-preview"
>
  <div data-testid="shell-labels" data-open-tab={$activeTab$?.title ?? ''}>
    <WorkspaceShellList workspaceId={LIST_LABELS_WORKSPACE} />
  </div>
  <div data-testid="shared-list-labels">
    <ListContainer>
      {#each items as item}
        <ListItem
          title={item.name}
          selected={selected === item.id}
          active={selected === item.id}
          onclick={() => (selected = item.id)}
        />
      {/each}
    </ListContainer>
  </div>
  <ListView
    {items}
    getKey={(item) => item.id}
    getText={(item) => item.name}
    selectable="single"
    bind:selectedKeys
    ariaLabel="Collection labels"
  >
    {#snippet row({ item })}<ListRow>{#snippet title()}{item.name}{/snippet}</ListRow>{/snippet}
  </ListView>
  <Sidebar.Provider persist={false} shortcut={null} class="min-h-0 w-full">
    <Sidebar.Menu>
      {#each ['Overview', 'Settings'] as label}
        <Sidebar.MenuItem
          ><Sidebar.MenuButton
            {label}
            aria-label={label}
            isActive={navigation === label}
            onclick={() => (navigation = label)}
          /></Sidebar.MenuItem
        >
      {/each}
    </Sidebar.Menu>
  </Sidebar.Provider>
  <div data-testid="action-labels" data-action={action}>
    <Menu.ActionRow selected={action === 'inspect'} onclick={() => (action = 'inspect')}>
      {#snippet title()}Inspect item{/snippet}
    </Menu.ActionRow>
  </div>
  <Button data-testid="ordinary-button" onclick={() => (ordinaryCount += 1)}>Continue</Button>
  <output aria-label="Ordinary activation count">{ordinaryCount}</output>
</section>

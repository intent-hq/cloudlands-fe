<script lang="ts">
  import { page } from '$app/state';
  import { faEllipsis, faFolder, faRobot, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import {
    DataList,
    ListRow,
    ListView,
    RowActions,
    SectionedList,
  } from '$lib/components/patterns/collection';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { SettingsFieldRow } from '$lib/components/ui/settings-field-row';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { fixture }: CatalogRendererProps = $props();
  let focusTarget: HTMLButtonElement | null = $state(null);
  const showGrid = $derived(page.url.searchParams.get('grid') === '1');
  const baselineRows = Array.from({ length: 256 });
  const listItems = [
    { id: 'default', title: 'Default row', description: 'Supporting text' },
    { id: 'selected', title: 'Selected row', description: 'Merged selection surface' },
    {
      id: 'long',
      title: 'A deliberately long collection row title that truncates before its actions',
      description: 'Secondary text remains readable.',
    },
  ];
  const sections = [{ id: 'recent', title: 'Recent work', items: listItems.slice(0, 2) }];
  const dataItems = [
    { key: 'repository', label: 'Repository', value: 'intent-hq/cloudlands-fe' },
    { key: 'branch', label: 'Branch', value: 'system-design', description: 'Local preview branch' },
  ];
  const actions = [
    { id: 'more', label: 'More details', icon: faEllipsis },
    { id: 'delete', label: 'Delete row', icon: faTrash, destructive: true },
  ];
  const workspaceRows = [
    { id: 'workspace-active', title: 'Active catalog workspace' },
    { id: 'workspace-unread', title: 'A very long unread workspace name that must truncate' },
  ];

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      focusTarget?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<div
  class="rows-matrix"
  data-baseline-grid={showGrid || undefined}
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  {#if showGrid}
    <div class="baseline-overlay" aria-hidden="true">
      {#each baselineRows as _}<i></i>{/each}
    </div>
  {/if}
  <section class="row-family" aria-labelledby="rows-list-row">
    <h3 id="rows-list-row" class="family-title">ListRow</h3>
    <div class="row-cell" data-row-preview="list-row-compositions">
      <ListRow>
        {#snippet leading()}<Fa icon={faFolder} class="size-4 text-muted-foreground" />{/snippet}
        {#snippet title()}Workspace sources{/snippet}
        {#snippet description()}Leading icon and secondary text{/snippet}
        {#snippet meta()}2 files{/snippet}
        {#snippet trailing()}<Badge variant="success">Ready</Badge>{/snippet}
      </ListRow>
      <ListRow>
        {#snippet leading()}
          <Badge class="size-6 rounded-full p-1">
            <Fa icon={faRobot} class="size-3" />
          </Badge>
        {/snippet}
        {#snippet title()}Avatar row{/snippet}
        {#snippet trailing()}
          <RowActions
            {actions}
            alwaysVisible
            visibleCount={1}
            overflowLabel="More avatar-row actions"
          />
        {/snippet}
      </ListRow>
    </div>
    <div class="row-cell" data-row-preview="list-row-selection-states">
      <ListView
        items={listItems}
        getKey={(item) => item.id}
        getText={(item) => item.title}
        selectable="multi"
        selectedKeys={['selected', 'long']}
        ariaLabel="Collection row states"
      >
        {#snippet row({ item })}
          <ListRow>
            {#snippet title()}{item.title}{/snippet}
            {#snippet description()}{item.description}{/snippet}
          </ListRow>
        {/snippet}
      </ListView>
    </div>
    <div class="row-cell" data-row-preview="list-row-loading-disabled">
      <ListView items={listItems.slice(0, 0)} status="loading" ariaLabel="Loading collection rows">
        {#snippet row({ item })}
          <ListRow>{#snippet title()}{item.title}{/snippet}</ListRow>
        {/snippet}
      </ListView>
      <ListRow aria-disabled="true" class="opacity-50">
        {#snippet title()}Disabled row{/snippet}
        {#snippet trailing()}<Badge>Loading</Badge>{/snippet}
      </ListRow>
    </div>
    <div class="row-cell" data-row-preview="list-row-compact">
      <SizeProvider size="compact">
        <ListRow>
          {#snippet title()}Compact density{/snippet}
          {#snippet trailing()}<Badge>28 px target</Badge>{/snippet}
        </ListRow>
      </SizeProvider>
    </div>
    <div class="row-cell zoom-preview" data-row-preview="list-row-zoom-200">
      <ListRow>
        {#snippet title()}200% zoom{/snippet}
        {#snippet description()}Content remains contained{/snippet}
      </ListRow>
    </div>
  </section>

  <section class="row-family" aria-labelledby="rows-sectioned-list">
    <h3 id="rows-sectioned-list" class="family-title">SectionedList</h3>
    <div class="row-cell" data-row-preview="sectioned-list">
      <SectionedList {sections} getKey={(section) => section.id}>
        {#snippet header(section)}{section.title}{/snippet}
        {#snippet children(section)}
          {#each section.items as item (item.id)}
            <ListRow>
              {#snippet title()}{item.title}{/snippet}
              {#snippet description()}{item.description}{/snippet}
            </ListRow>
          {/each}
        {/snippet}
      </SectionedList>
    </div>
  </section>

  <section class="row-family" aria-labelledby="rows-data-list">
    <h3 id="rows-data-list" class="family-title">DataList</h3>
    <div class="row-cell" data-row-preview="data-list"><DataList items={dataItems} /></div>
  </section>

  <section class="row-family" aria-labelledby="rows-table">
    <h3 id="rows-table" class="family-title">Table</h3>
    <div class="row-cell" data-row-preview="table-header-body-selected">
      <Table.Root aria-label="Workspace row comparison">
        <Table.Header>
          <Table.Row><Table.Head>Workspace</Table.Head><Table.Head>Status</Table.Head></Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row><Table.Cell>Default row</Table.Cell><Table.Cell>Idle</Table.Cell></Table.Row>
          <Table.Row data-state="selected">
            <Table.Cell>Selected row</Table.Cell><Table.Cell>Active</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>
    </div>
  </section>

  <section class="row-family" aria-labelledby="rows-sidebar">
    <h3 id="rows-sidebar" class="family-title">Sidebar rows</h3>
    <div class="row-cell bg-sidebar" data-row-preview="workspace-sidebar-rows">
      <Sidebar.Provider open persist={false} class="min-h-0!">
        <Sidebar.Menu>
          {#each workspaceRows as workspace, index (workspace.id)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton
                label={workspace.title}
                status={index === 0 ? 'active' : 'unread'}
                aria-label={workspace.title}
              />
              {#if index === 1}<Sidebar.MenuBadge>1</Sidebar.MenuBadge>{/if}
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Provider>
    </div>
    <div class="row-cell bg-sidebar" data-row-preview="agent-sidebar-rows">
      <Sidebar.Provider open persist={false} class="min-h-0!">
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton label="Active catalog implementor" status="active">
              {#snippet icon()}<Fa icon={faRobot} />{/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton label="A very long background agent name that must truncate">
              {#snippet icon()}<Fa icon={faRobot} />{/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Provider>
    </div>
    <div class="row-cell bg-sidebar" data-row-preview="sidebar-menu-states">
      <Sidebar.Provider open persist={false} class="min-h-0!">
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton bind:ref={focusTarget} label="Focused navigation" />
          </Sidebar.MenuItem>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton label="Current navigation" isActive status="active" />
          </Sidebar.MenuItem>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton label="Unread navigation" status="unread" />
            <Sidebar.MenuBadge>3</Sidebar.MenuBadge>
            <Sidebar.MenuAction showOnHover aria-label="Unread row actions">⋯</Sidebar.MenuAction>
          </Sidebar.MenuItem>
          <Sidebar.MenuItem
            ><Sidebar.MenuButton label="Disabled navigation" disabled /></Sidebar.MenuItem
          >
        </Sidebar.Menu>
      </Sidebar.Provider>
    </div>
  </section>

  <section class="row-family" aria-labelledby="rows-menu">
    <h3 id="rows-menu" class="family-title">Menu item rows</h3>
    <div class="row-cell" data-row-preview="menu-item-states">
      <Menu.Root open staticPosition>
        <Menu.Content class="w-full">
          <Menu.Item>Default item</Menu.Item>
          <Menu.Item data-highlighted>Hover / highlighted</Menu.Item>
          <Menu.Item data-state="open">Active item</Menu.Item>
          <Menu.Item disabled>Disabled item</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  </section>

  <section class="row-family" aria-labelledby="rows-settings">
    <h3 id="rows-settings" class="family-title">SettingsFieldRow</h3>
    <div class="row-cell" data-row-preview="settings-field-row-default-busy">
      <SettingsFieldRow
        id="rows-setting"
        label="Workspace notifications"
        description="Receive updates when a workspace needs attention."
        busy
        status="Saving changes"
      >
        <Button size="sm" loading>Saving</Button>
      </SettingsFieldRow>
    </div>
    <div class="row-cell" data-row-preview="settings-field-row-compact-disabled">
      <SettingsFieldRow id="rows-setting-compact" label="Compact disabled field" compact disabled>
        <Button size="sm" disabled>Unavailable</Button>
      </SettingsFieldRow>
    </div>
  </section>

  <section class="row-family tabs-family" aria-labelledby="rows-tabs">
    <h3 id="rows-tabs" class="family-title">Tab strip items</h3>
    <div class="row-cell" data-row-preview="panel-tab-strip">
      <Tabs.Root value="file">
        <Tabs.List class="w-full justify-start overflow-hidden" aria-label="Panel tabs">
          <Tabs.Trigger value="note">Implementation plan</Tabs.Trigger>
          <Tabs.Trigger value="agent">Catalog implementor</Tabs.Trigger>
          <Tabs.Trigger value="file">RowsCatalogPreview.svelte</Tabs.Trigger>
          <Tabs.Trigger value="browser">Browser preview</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
    </div>
    <div class="row-cell" data-row-preview="workspace-tab-strip">
      <Tabs.Root value="active">
        <Tabs.List class="w-full justify-start overflow-hidden" aria-label="Workspace tabs">
          <Tabs.Trigger value="active">Active workspace</Tabs.Trigger>
          <Tabs.Trigger value="unread">Unread workspace</Tabs.Trigger>
          <Tabs.Trigger value="disabled" disabled>Disabled workspace</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
    </div>
    <div class="row-cell" data-row-preview="dragging-placeholder">
      <div class="drag-placeholder" aria-hidden="true" data-dragging-placeholder></div>
      <span class="sr-only">Dragging placeholder</span>
    </div>
  </section>
</div>

<style>
  .rows-matrix {
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    align-items: start;
    gap: var(--catalog-row-gap);
  }
  .baseline-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: none;
  }
  .baseline-overlay i {
    flex: 0 0 4px;
    border-bottom: 1px solid hsl(var(--foreground) / 0.08);
  }
  .row-family {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: var(--space-2);
  }
  .family-title {
    font-size: var(--text-caption);
    font-weight: 500;
    color: hsl(var(--muted-foreground));
  }
  .row-cell {
    min-width: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background-color: hsl(var(--background));
  }
  .zoom-preview {
    width: 50%;
    zoom: 2;
  }
  .tabs-family {
    grid-column: 1 / -1;
  }
  .drag-placeholder {
    height: var(--control-height-medium);
    border: 1px dashed hsl(var(--border));
    background: hsl(var(--muted) / 0.4);
  }
</style>

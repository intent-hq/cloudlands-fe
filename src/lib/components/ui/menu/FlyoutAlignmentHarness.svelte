<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import { Dropdown } from '$lib/components/ui/dropdown';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';

  let {
    kind = 'menu',
    portal = true,
    x = 48,
    y = 48,
    align,
    alignOffset,
  }: {
    kind?: 'menu' | 'dropdown' | 'sidebar';
    portal?: boolean;
    x?: number;
    y?: number;
    align?: 'start' | 'center' | 'end';
    alignOffset?: number;
  } = $props();

  let selected = $state('none');
  let sidebarOpen = $state(true);
  const labels = ['First child', 'Second child', 'Third child', 'Fourth child'];
</script>

<div style="position: fixed; left: {x}px; top: {y}px;">
  {#if kind === 'menu'}
    <Menu.Root>
      <Menu.Trigger>Open flyout menu</Menu.Trigger>
      <Menu.Content align="start" collisionPadding={8}>
        <Menu.Item>Before submenu</Menu.Item>
        <Menu.Sub>
          <Menu.SubTrigger>More actions</Menu.SubTrigger>
          <Menu.SubContent {portal} {align} {alignOffset} collisionPadding={8}>
            {#each labels as label}
              <Menu.Item onSelect={() => (selected = label)}>{label}</Menu.Item>
            {/each}
          </Menu.SubContent>
        </Menu.Sub>
      </Menu.Content>
    </Menu.Root>
  {:else if kind === 'dropdown'}
    <Dropdown
      searchable={false}
      animate={false}
      placeholder="Open flyout dropdown"
      options={[
        { value: 'before', label: 'Before submenu' },
        {
          value: 'more',
          label: 'More actions',
          type: 'submenu',
          children: labels.map((label) => ({ value: label, label })),
        },
      ]}
      onchange={(value) => (selected = String(value))}
    />
  {:else if sidebarOpen}
    <SidebarContextMenu
      {x}
      {y}
      items={[
        { id: 'before', label: 'Before submenu', onClick: () => (selected = 'before') },
        {
          id: 'more',
          label: 'More actions',
          onClick: () => {},
          submenu: labels.map((label) => ({
            id: label,
            label,
            onClick: () => (selected = label),
          })),
        },
      ]}
      onClickOutside={() => (sidebarOpen = false)}
    />
  {/if}
</div>
<output data-testid="selected">{selected}</output>

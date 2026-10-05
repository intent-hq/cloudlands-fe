<script lang="ts">
  import { faPencil, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import SidebarContextMenu from './SidebarContextMenu.svelte';
  import SidebarOverflowMenu from './SidebarOverflowMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from './types';

  let {
    edge = false,
    long = false,
    multiline = false,
  }: { edge?: boolean; long?: boolean; multiline?: boolean } = $props();
  let context = $state<SidebarContextPosition | null>(null);
  let checked = $state(false);
  let choice = $state('first');
  let selected = $state('none');
  const items = $derived<SidebarMenuEntry[]>([
    { type: 'separator' },
    { id: 'rename', label: 'Rename', icon: faPencil, onClick: () => (selected = 'rename') },
    {
      id: 'locked',
      label: 'Locked',
      icon: multiline ? faPencil : undefined,
      shortcut: multiline ? '⌘K' : undefined,
      disabledReason: multiline
        ? 'Requires access from the workspace owner before this command can be used.'
        : 'Requires access',
      onClick: () => (selected = 'locked'),
    },
    { type: 'separator' },
    { type: 'separator' },
    { id: 'details', label: 'Show details', checked, onClick: () => (checked = !checked) },
    {
      id: 'choices',
      label: 'Assign slot',
      selection: 'single',
      onClick: () => {},
      submenu: [
        {
          id: 'first',
          label: 'First slot',
          checked: choice === 'first',
          onClick: () => (choice = 'first'),
        },
        {
          id: 'second',
          label: 'Second slot',
          checked: choice === 'second',
          onClick: () => (choice = 'second'),
        },
      ],
    },
    {
      id: 'more',
      label: 'More',
      onClick: () => {},
      submenu: [{ id: 'export', label: 'Export', onClick: () => (selected = 'export') }],
    },
    ...(long
      ? Array.from({ length: 35 }, (_, i) => ({
          id: `extra-${i}`,
          label: `Extra command ${i}`,
          onClick: () => (selected = `extra-${i}`),
        }))
      : []),
    { type: 'separator' },
    {
      id: 'delete',
      label: 'Delete',
      icon: faTrash,
      destructive: true,
      onClick: () => (selected = 'delete'),
    },
    { type: 'separator' },
  ]);

  function invoke(event: MouseEvent | KeyboardEvent) {
    const position = getSidebarContextPosition(event);
    if (position) context = position;
  }
</script>

<div style={edge ? 'position: fixed; right: 12px; bottom: 12px;' : undefined}>
  <Button oncontextmenu={invoke} onkeydown={invoke}>Workspace</Button>
  <SidebarOverflowMenu {items} ariaLabel="Workspace actions" />
</div>
<Button>After menu</Button>
{#if context}
  <SidebarContextMenu
    {...context}
    {items}
    ariaLabel="Workspace actions"
    onClickOutside={() => (context = null)}
  />
{/if}
<output data-testid="selection">{selected}</output>
<output data-testid="checked">{String(checked)}</output>
<output data-testid="choice">{choice}</output>

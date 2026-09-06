<script lang="ts">
  import { faPencil, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ActionBar from './ActionBar.svelte';
  import ActionMenu from './ActionMenu.svelte';
  import { defineActions } from './actions';

  let {
    bar = false,
    context = false,
    visibleCount = 1,
  }: {
    bar?: boolean;
    context?: boolean;
    visibleCount?: number;
  } = $props();

  let selected = $state('none');
  const actions = defineActions([
    { id: 'edit', label: 'Edit', icon: faPencil, shortcut: '⌘E', group: 'file' },
    { id: 'hidden', label: 'Hidden', when: false, group: 'file' },
    {
      id: 'export',
      label: 'Export',
      group: 'file',
      children: [{ id: 'export-pdf', label: 'Export as PDF' }],
    },
    { id: 'locked', label: 'Locked', disabledReason: 'Requires access', group: 'file' },
    { id: 'delete', label: 'Delete', icon: faTrash, destructive: true, group: 'danger' },
  ]);
</script>

{#if bar}
  <ActionBar
    {actions}
    {visibleCount}
    overflowLabel="More actions"
    onAction={(id) => (selected = id)}
  />
{:else}
  <ActionMenu
    {actions}
    ariaLabel="Document actions"
    contextMenu={context ? { x: 24, y: 32 } : undefined}
    onAction={(id) => (selected = id)}
  >
    {#snippet trigger({ props })}
      <Button {...props}>Actions</Button>
    {/snippet}
  </ActionMenu>
{/if}

<output data-testid="selected">{selected}</output>

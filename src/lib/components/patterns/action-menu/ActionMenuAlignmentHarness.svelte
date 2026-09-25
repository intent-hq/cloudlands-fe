<script lang="ts">
  import { faPencil } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ActionMenu from './ActionMenu.svelte';
  import type { ActionDefinition } from './types';

  let {
    iconSource = 'root',
    multiline = false,
  }: {
    iconSource?: 'root' | 'section' | 'radio' | 'submenu' | 'hidden';
    multiline?: boolean;
  } = $props();
  let checked = $state(false);
  let density = $state('comfortable');
  let selected = $state('none');
  const actions = $derived<ActionDefinition[]>([
    { id: 'heading', kind: 'label', label: 'Workspace' },
    { id: 'rename', label: 'Rename', icon: iconSource === 'root' ? faPencil : undefined },
    { id: 'hidden', label: 'Hidden icon', icon: faPencil, when: false },
    {
      id: 'section',
      kind: 'section',
      label: 'Manage',
      children: [
        { id: 'edit', label: 'Edit', icon: iconSource === 'section' ? faPencil : undefined },
        {
          id: 'locked',
          label: 'Locked',
          icon: multiline ? faPencil : undefined,
          shortcut: multiline ? '⌘K' : undefined,
          disabledReason: multiline
            ? 'Requires access from the workspace owner before this command can be used.'
            : 'Requires access',
        },
      ],
    },
    {
      id: 'details',
      kind: 'checkbox',
      label: 'Show details',
      checked: multiline || checked,
      group: 'view',
      icon: multiline ? faPencil : undefined,
      disabledReason: multiline
        ? 'Details are unavailable until this workspace finishes loading.'
        : undefined,
    },
    {
      id: 'density',
      kind: 'radio-group',
      label: 'Density',
      value: multiline ? 'compact' : density,
      children: [
        {
          id: 'compact',
          kind: 'radio',
          label: 'Compact',
          value: 'compact',
          icon: iconSource === 'radio' || multiline ? faPencil : undefined,
          disabledReason: multiline
            ? 'This density is unavailable while the workspace is loading.'
            : undefined,
        },
        { id: 'comfortable', kind: 'radio', label: 'Comfortable', value: 'comfortable' },
      ],
    },
    {
      id: 'more',
      kind: 'submenu',
      label: 'More',
      icon: multiline ? faPencil : undefined,
      disabledReason: multiline
        ? 'Additional commands are unavailable until the workspace finishes loading.'
        : undefined,
      children: [
        { id: 'export', label: 'Export', icon: iconSource === 'submenu' ? faPencil : undefined },
        { id: 'copy', label: 'Copy', group: 'other' },
      ],
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: multiline ? faPencil : undefined,
      destructive: true,
      group: 'destructive',
    },
  ]);
</script>

<ActionMenu
  {actions}
  class={multiline ? 'w-72' : undefined}
  ariaLabel="Workspace menu"
  onAction={(id) => {
    selected = id;
    if (id === 'details') checked = !checked;
    if (id === 'compact' || id === 'comfortable') density = id;
  }}
>
  {#snippet trigger({ props })}<Button {...props}>Actions</Button>{/snippet}
</ActionMenu>
<output data-testid="selection">{selected}</output>

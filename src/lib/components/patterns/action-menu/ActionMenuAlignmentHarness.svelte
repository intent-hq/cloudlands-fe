<script lang="ts">
  import { faPencil } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ActionMenu from './ActionMenu.svelte';
  import type { ActionDefinition } from './types';

  let {
    iconSource = 'root',
  }: {
    iconSource?: 'root' | 'section' | 'radio' | 'submenu' | 'hidden';
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
        { id: 'locked', label: 'Locked', disabledReason: 'Requires access' },
      ],
    },
    { id: 'details', kind: 'checkbox', label: 'Show details', checked, group: 'view' },
    {
      id: 'density',
      kind: 'radio-group',
      label: 'Density',
      value: density,
      children: [
        {
          id: 'compact',
          kind: 'radio',
          label: 'Compact',
          value: 'compact',
          icon: iconSource === 'radio' ? faPencil : undefined,
        },
        { id: 'comfortable', kind: 'radio', label: 'Comfortable', value: 'comfortable' },
      ],
    },
    {
      id: 'more',
      kind: 'submenu',
      label: 'More',
      children: [
        { id: 'export', label: 'Export', icon: iconSource === 'submenu' ? faPencil : undefined },
        { id: 'copy', label: 'Copy', group: 'other' },
      ],
    },
    { id: 'delete', label: 'Delete', destructive: true, group: 'destructive' },
  ]);
</script>

<ActionMenu
  {actions}
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

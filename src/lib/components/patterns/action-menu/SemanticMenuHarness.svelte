<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ActionMenu from './ActionMenu.svelte';
  import type { ActionDefinition } from './types';

  let checked = $state(false);
  let density = $state('comfortable');
  let choices = $state<string[]>([]);
  const actions = $derived<ActionDefinition[]>([
    { kind: 'checkbox', id: 'details', label: 'Show details', checked },
    {
      kind: 'radio-group',
      id: 'density',
      label: 'Density',
      value: density,
      children: [
        { kind: 'radio', id: 'compact', label: 'Compact', value: 'compact' },
        { kind: 'radio', id: 'comfortable', label: 'Comfortable', value: 'comfortable' },
      ],
    },
  ]);
</script>

<ActionMenu
  {actions}
  ariaLabel="Preferences"
  onAction={(id) => {
    choices = [...choices, id];
    if (id === 'details') checked = !checked;
    else density = id;
  }}
>
  {#snippet trigger({ props })}<Button {...props}>Preferences</Button>{/snippet}
</ActionMenu>
<output data-testid="choices">{choices.join(',')}</output>

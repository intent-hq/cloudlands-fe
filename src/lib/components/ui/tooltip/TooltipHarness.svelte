<script lang="ts">
  import Button from '../button/button.svelte';
  import * as Tooltip from './index';

  let { open = $bindable(false), delayDuration = 80 }: { open?: boolean; delayDuration?: number } =
    $props();
</script>

<Tooltip.Provider {delayDuration}>
  <Tooltip.Root bind:open {delayDuration}>
    <Tooltip.Trigger aria-label="Show keyboard help">Show keyboard help</Tooltip.Trigger>
    <Tooltip.Content side="bottom">Press Command K to open navigation.</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
<output aria-label="Tooltip open state">{open}</output>

<div data-testid="wrapped-tooltip">
  <Tooltip.Tooltip content="Wrapped button help" delayDuration={0}>
    <Button aria-label="Show wrapped help" variant="ghost">Wrapped help</Button>
  </Tooltip.Tooltip>
</div>

<div data-testid="rich-tooltip">
  <Tooltip.TooltipRich title="Rich button help" delayDuration={0}>
    <button type="button" aria-label="Show rich help">Rich help</button>
  </Tooltip.TooltipRich>
</div>

<div data-testid="passive-tooltip">
  <Tooltip.Tooltip content="Passive status help" delayDuration={0}>
    <span>Passive status</span>
  </Tooltip.Tooltip>
</div>

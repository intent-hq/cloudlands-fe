<script lang="ts">
  /* eslint-disable intent/no-raw-menu-row -- Static tooltip fixture, not a rendered menu row. */
  import Button from '../button/button.svelte';
  import { menuOverlay } from '$lib/components/ui/menu';
  import * as Tooltip from './index';

  let {
    open = $bindable(false),
    delayDuration = 80,
    secondary,
  }: {
    open?: boolean;
    delayDuration?: number;
    secondary?: { label: string; shortcut: string | string[] };
  } = $props();
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
  <Tooltip.TooltipRich title="Rich button help" delayDuration={0} showClose>
    <button type="button" aria-label="Show rich help">Rich help</button>
  </Tooltip.TooltipRich>
</div>

<div data-testid="shortcut-tooltip">
  <Tooltip.TooltipShortcut
    label="Open navigation"
    shortcut="mod+k"
    {secondary}
    delayDuration={0}
    portalTarget="[data-testid='shortcut-tooltip']"
  >
    <Button aria-label="Show shortcut help" variant="ghost">Shortcut help</Button>
  </Tooltip.TooltipShortcut>
</div>

<div data-testid="passive-tooltip">
  <Tooltip.Tooltip content="Passive status help" delayDuration={0}>
    <span>Passive status</span>
  </Tooltip.Tooltip>
</div>

<!-- Static stand-in for bits-ui menu content: the wrapper must not become a
     nested interactive element inside role="menu"/role="menuitem". -->
<!-- i18n-ignore (test harness fixture, not user-facing) -->
<div
  data-testid="menu-tooltip"
  role="menu"
  aria-label="Menu tooltip case"
  tabindex="-1"
  class={menuOverlay()}
>
  <div role="menuitem" tabindex="-1">
    <Tooltip.Tooltip content="Menu status help" delayDuration={0}>
      <!-- i18n-ignore (test harness fixture, not user-facing) -->
      <span>Menu status</span>
    </Tooltip.Tooltip>
  </div>
</div>

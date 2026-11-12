<!--
  A row of the ordered machine list without a richer row of its own: "This
  computer" (the backend itself), or a machine or cloud entry whose details
  this window can't read (a member sees only the names in the order).
-->
<script lang="ts">
  import { Fa } from 'svelte-fa';
  import { ListRow, RowActions } from '$lib/components/patterns/collection';
  import { faCloud, faDesktop } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { MachineOrderRow } from '$shared/types/remote-machines';
  import type { MachineOrderControls } from './machine-order-controls';
  import PreferredMachineBadge from './PreferredMachineBadge.svelte';

  let {
    row,
    order,
    localBackend = false,
    backendLabel,
  }: {
    row: MachineOrderRow;
    order: MachineOrderControls;
    /** The current backend is this app's own daemon. */
    localBackend?: boolean;
    backendLabel: string;
  } = $props();

  const label = $derived(
    row.kind === 'local' && localBackend ? m.remoteMachines_order_local_label() : row.name,
  );
  const detail = $derived(
    row.kind !== 'local'
      ? null
      : localBackend
        ? row.name
        : m.remoteMachines_order_backendHost_label({ backend: backendLabel }),
  );
</script>

<article aria-label={label} data-machine-order-plain-row={row.kind}>
  <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
    {#snippet leading()}
      <Fa icon={row.kind === 'cloud' ? faCloud : faDesktop} class="size-5! text-foreground" />
    {/snippet}
    {#snippet title()}{label}{/snippet}
    {#snippet meta()}
      {#if order.preferred}<PreferredMachineBadge />{/if}
      {#if detail}<span>{detail}</span>{/if}
    {/snippet}
    {#snippet trailing()}
      {#if order.actions.length > 0}
        <RowActions
          alwaysVisible
          actions={order.actions}
          onAction={(id) => order.onAction(id)}
          visibleCount={0}
          overflowLabel={m.settings_devices_actionsFor_ariaLabel({ name: label })}
        />
      {/if}
    {/snippet}
  </ListRow>
</article>

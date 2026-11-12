<script lang="ts">
  import { ListView } from '$lib/components/patterns/collection';
  import { m } from '$shared/paraglide/messages.js';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import RemoteMachineRow from './RemoteMachineRow.svelte';
  import {
    selectCurrentBackendLabel,
    selectLocalMachineFingerprint,
    selectRemoteMachines,
    selectRemoteMachinesVisible,
  } from './remote-machines-selectors';
  import { connectionForMachine } from './remote-machines-utils';

  const supported$ = selectRemoteMachinesVisible();
  const machines$ = selectRemoteMachines();
  const connections$ = selectConnections();
  const localFingerprint$ = selectLocalMachineFingerprint();
  const backendLabel$ = selectCurrentBackendLabel();

  // Nodes, and machines this app has no connection to (added from an
  // intent://node link), are listed under Nodes.
  const machines = $derived(
    $machines$.filter((machine) => {
      const id = connectionForMachine(machine, $connections$, $localFingerprint$);
      return id !== null && !$connections$.some((c) => c.id === id && c.daemonMode === 'node');
    }),
  );
</script>

{#if $supported$ && machines.length > 0}
  <section class="space-y-3" aria-labelledby="remote-machines-title">
    <div>
      <h3 id="remote-machines-title" class="type-title text-foreground">
        {m.remoteMachines_section_title({ backend: $backendLabel$ })}
      </h3>
      <p class="max-w-2xl type-body text-muted-foreground">
        {m.remoteMachines_section_description({ backend: $backendLabel$ })}
      </p>
    </div>
    <ListView
      virtualize={false}
      items={machines}
      getKey={(machine) => machine.id}
      getText={(machine) => machine.name}
      ariaLabel={m.remoteMachines_section_title({ backend: $backendLabel$ })}
      class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
    >
      {#snippet row({ item: machine })}
        <RemoteMachineRow {machine} />
      {/snippet}
    </ListView>
  </section>
{/if}

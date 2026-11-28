<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { m } from '$shared/paraglide/messages.js';
  import { remoteMachineBadge } from './remote-machines-messages';

  // Only a problem gets a pill; a machine that can run agents shows none.
  let {
    machine,
    backendLabel,
    showDisconnected = false,
  }: {
    machine: RemoteMachine;
    backendLabel: string;
    /** Show the on-demand connection label for idle runner rows. */
    showDisconnected?: boolean;
  } = $props();
  const badge = $derived(remoteMachineBadge(machine, backendLabel));
</script>

{#if badge.color !== 'green'}
  <Badge variant="dot" color={badge.color}>{badge.label}</Badge>
{:else if showDisconnected && machine.state === 'disconnected'}
  <span>{m.remoteMachines_state_connectsOnDemand_label()}</span>
{/if}

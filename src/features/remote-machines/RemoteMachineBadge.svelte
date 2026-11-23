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
    /** Runner rows have no status dot, so a disconnected runner says so. */
    showDisconnected?: boolean;
  } = $props();
  const badge = $derived(remoteMachineBadge(machine, backendLabel));
</script>

{#if badge.color !== 'green'}
  <Badge variant="dot" color={badge.color}>{badge.label}</Badge>
{:else if showDisconnected && machine.state === 'disconnected'}
  <span data-runner-disconnected>{m.settings_devices_statusDisconnected_label()}</span>
{/if}

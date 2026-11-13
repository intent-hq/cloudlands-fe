<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { remoteMachineBadge } from './remote-machines-messages';

  // Only a problem gets a pill; a machine that can run agents shows none.
  let {
    machine,
    backendLabel,
  }: {
    machine: RemoteMachine;
    backendLabel: string;
  } = $props();
  const badge = $derived(remoteMachineBadge(machine, backendLabel));
</script>

{#if badge.color !== 'green'}
  <Badge variant="dot" color={badge.color}>{badge.label}</Badge>
{/if}
